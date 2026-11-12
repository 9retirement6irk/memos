package store

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"strings"

	"github.com/pkg/errors"
)

// UserRecordKind names one kind of per-user record: a small JSON document a
// feature keeps for each user, such as their journal settings or the key to
// one of their own servers. Keys stay on the server.
//
// A record is a system_setting row named by its kind and the user's ID, like
// the Immich connection and the configuration state record: the instance
// setting reads skip it, because convertInstanceSettingFromRaw has no case for
// its name. That keeps it out of every settings API and needs no schema change.
type UserRecordKind string

const (
	// UserRecordJournalSettings holds how the user's journal works.
	UserRecordJournalSettings UserRecordKind = "JOURNAL_SETTINGS_"
	// UserRecordDawarichConnection holds the user's Dawarich address and API key.
	UserRecordDawarichConnection UserRecordKind = "DAWARICH_CONNECTION_"
	// UserRecordJournalReminder holds the user's Home Assistant reminder.
	UserRecordJournalReminder UserRecordKind = "JOURNAL_REMINDER_"
)

// userRecordKinds lists every kind, so a deleted user's records all go.
var userRecordKinds = []UserRecordKind{UserRecordJournalSettings, UserRecordDawarichConnection, UserRecordJournalReminder}

func userRecordName(kind UserRecordKind, userID int32) string {
	return string(kind) + strconv.FormatInt(int64(userID), 10)
}

// GetUserRecord decodes the user's record of the kind into out. It reports
// false, leaving out alone, when the user has none.
func (s *Store) GetUserRecord(ctx context.Context, kind UserRecordKind, userID int32, out any) (bool, error) {
	list, err := s.driver.ListInstanceSettings(ctx, &FindInstanceSetting{Name: userRecordName(kind, userID)})
	if err != nil {
		return false, errors.Wrapf(err, "failed to read %s record", kind)
	}
	if len(list) == 0 {
		return false, nil
	}
	if err := json.Unmarshal([]byte(list[0].Value), out); err != nil {
		return false, errors.Wrapf(err, "failed to decode %s record", kind)
	}
	return true, nil
}

// UpsertUserRecord saves value as the user's record of the kind, replacing
// any earlier one.
func (s *Store) UpsertUserRecord(ctx context.Context, kind UserRecordKind, userID int32, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return errors.Wrapf(err, "failed to encode %s record", kind)
	}
	if _, err := s.driver.UpsertInstanceSetting(ctx, &InstanceSetting{
		Name:        userRecordName(kind, userID),
		Value:       string(encoded),
		Description: "Per-user record",
	}); err != nil {
		return errors.Wrapf(err, "failed to save %s record", kind)
	}
	return nil
}

// DeleteUserRecord removes the user's record of the kind, if any.
func (s *Store) DeleteUserRecord(ctx context.Context, kind UserRecordKind, userID int32) error {
	if err := s.driver.DeleteInstanceSetting(ctx, &DeleteInstanceSetting{Name: userRecordName(kind, userID)}); err != nil {
		return errors.Wrapf(err, "failed to delete %s record", kind)
	}
	return nil
}

// ListUserRecords returns every user's record of the kind as raw JSON, by
// user ID. Background jobs use it to find the users a feature is on for.
func (s *Store) ListUserRecords(ctx context.Context, kind UserRecordKind) (map[int32]string, error) {
	list, err := s.driver.ListInstanceSettings(ctx, &FindInstanceSetting{})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to list %s records", kind)
	}
	records := map[int32]string{}
	for _, setting := range list {
		rest, ok := strings.CutPrefix(setting.Name, string(kind))
		if !ok {
			continue
		}
		userID, err := strconv.ParseInt(rest, 10, 32)
		if err != nil {
			continue
		}
		records[int32(userID)] = setting.Value
	}
	return records, nil
}

// removeDeletedUserRecords drops a deleted user's records. The user is
// already gone, so a failure only leaves rows nothing reads.
func (s *Store) removeDeletedUserRecords(ctx context.Context, userID int32) {
	for _, kind := range userRecordKinds {
		if err := s.DeleteUserRecord(ctx, kind, userID); err != nil {
			slog.Warn("failed to remove deleted user's record", slog.String("kind", string(kind)), slog.Int("userID", int(userID)), slog.String("error", err.Error()))
		}
	}
}
