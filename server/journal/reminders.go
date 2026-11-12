package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/homeassistant"
	"github.com/usememos/memos/store"
)

const (
	// reminderWindowMinutes is how late a reminder still goes, so one missed
	// while the server was down goes when it is back, but not at midnight.
	reminderWindowMinutes = 180
	// streakLookback bounds how far back a streak is counted.
	streakLookback = 400 * 24 * time.Hour
	// maxStreakEntries bounds the entries read to count a streak.
	maxStreakEntries = 2000
	dateLayout       = "2006-01-02"
)

// RunReminders sends due reminders once a minute until ctx ends.
func (s *Service) RunReminders(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		s.SendDueReminders(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// SendDueReminders sends every reminder that is due now.
func (s *Service) SendDueReminders(ctx context.Context) {
	records, err := s.Store.ListUserRecords(ctx, store.UserRecordJournalReminder)
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("failed to list journal reminders", slog.String("error", err.Error()))
		}
		return
	}
	for userID, raw := range records {
		reminder := &Reminder{}
		if err := json.Unmarshal([]byte(raw), reminder); err != nil || !reminder.Enabled {
			continue
		}
		if err := s.sendIfDue(ctx, userID, reminder); err != nil && ctx.Err() == nil {
			slog.Warn("failed to send journal reminder", slog.Int("userID", int(userID)), slog.String("error", err.Error()))
		}
	}
}

// sendIfDue sends the user's reminder when it is due and hasn't gone today.
func (s *Service) sendIfDue(ctx context.Context, userID int32, reminder *Reminder) error {
	location, err := time.LoadLocation(reminder.Timezone)
	if err != nil {
		return errors.Wrap(err, "unknown time zone")
	}
	now := s.now().In(location)
	today := now.Format(dateLayout)
	if reminder.LastSent == today || !slices.Contains(reminder.Days, int(now.Weekday())) {
		return nil
	}
	at, err := parseClock(reminder.Time)
	if err != nil {
		return errors.Wrap(err, "invalid reminder time")
	}
	minutes := now.Hour()*60 + now.Minute()
	if minutes < at || minutes > at+reminderWindowMinutes {
		return nil
	}

	wrote, streak, err := s.journalDays(ctx, userID, now)
	if err != nil {
		return err
	}
	if !reminder.OnlyIfNotWritten || !wrote {
		client, err := homeassistant.NewClient(reminder.URL, reminder.Token, s.HTTPClient)
		if err != nil {
			return err
		}
		// A failed send isn't marked, so it tries again next minute while the
		// window lasts.
		if err := client.Notify(ctx, reminder.Notifier, reminderNotification(reminder, wrote, streak)); err != nil {
			return errors.Wrap(err, homeassistant.Explain(err))
		}
	}
	reminder.LastSent = today
	return s.Store.UpsertUserRecord(ctx, store.UserRecordJournalReminder, userID, reminder)
}

// reminderNotification words the reminder for the user's day.
func reminderNotification(reminder *Reminder, wrote bool, streak int) homeassistant.Notification {
	notification := homeassistant.Notification{URL: reminder.OpenURL, ActionTitle: "Write now"}
	switch {
	case wrote:
		notification.Title = "Your journal"
		notification.Message = "You've written today. Anything to add?"
	case streak > 0 && reminder.StreakWarning:
		notification.Title = fmt.Sprintf("Your %d-day journal streak ends tonight", streak)
		notification.Message = "You haven't written today. A couple of minutes is enough."
	default:
		notification.Title = "Time for your journal"
		notification.Message = "How was today? A couple of minutes is enough."
	}
	return notification
}

// journalDays reports whether the user wrote a journal entry on now's date,
// and their streak: the run of days with an entry, ending today if they wrote
// today, or else yesterday.
func (s *Service) journalDays(ctx context.Context, userID int32, now time.Time) (bool, int, error) {
	settings := settingsSpace{}
	if _, err := s.Store.GetUserRecord(ctx, store.UserRecordJournalSettings, userID, &settings); err != nil {
		return false, 0, err
	}
	since := now.Add(-streakLookback).Unix()
	filter := fmt.Sprintf("created_ts >= timestamp(%d)", since)
	if spaceNamePattern.MatchString(settings.Space) {
		filter = fmt.Sprintf("space == %q && %s", settings.Space, filter)
	}
	status := store.Normal
	limit := maxStreakEntries
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		CreatorID:       &userID,
		RowStatus:       &status,
		ExcludeContent:  true,
		ExcludeComments: true,
		Filters:         []string{filter},
		Limit:           &limit,
	})
	if err != nil {
		return false, 0, errors.Wrap(err, "failed to list journal entries")
	}
	days := map[string]bool{}
	for _, memo := range memos {
		days[time.Unix(memo.CreatedTs, 0).In(now.Location()).Format(dateLayout)] = true
	}
	return days[now.Format(dateLayout)], streakEnding(days, now), nil
}

// streakEnding counts the consecutive days with an entry, ending today when
// today has one, otherwise yesterday.
func streakEnding(days map[string]bool, now time.Time) int {
	day := now
	if !days[day.Format(dateLayout)] {
		day = day.AddDate(0, 0, -1)
	}
	streak := 0
	for days[day.Format(dateLayout)] {
		streak++
		day = day.AddDate(0, 0, -1)
	}
	return streak
}
