// Package journal serves /api/journal: each signed-in user's journal
// settings, and their streak reminder, which a background job sends through
// their own Home Assistant.
//
// Journal entries themselves are ordinary memos in the user's journal Space,
// with their mood and activities written as tags. Nothing here is needed to
// read them, so they stay whole in a Memos without this package.
package journal

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/usememos/memos/internal/homeassistant"
	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// maxSettingsBytes bounds the settings document.
	maxSettingsBytes = 64 << 10
	// maxRequestBytes bounds a reminder request.
	maxRequestBytes = 16 << 10
)

// spaceNamePattern is a Space resource name, safe to put in a memo filter.
var spaceNamePattern = regexp.MustCompile(`^spaces/[A-Za-z0-9_-]{1,64}$`)

// Service handles the /api/journal routes and runs the reminder job.
type Service struct {
	Store         *store.Store
	authenticator *auth.Authenticator
	// HTTPClient calls Home Assistant; nil refuses the Memos server's own
	// addresses. Tests replace it to reach a fake server on loopback.
	HTTPClient *http.Client
	// Now is the clock; nil is time.Now. Tests set it.
	Now func() time.Time
}

// NewService returns the service for the store and the instance secret.
func NewService(store *store.Store, secret string) *Service {
	return &Service{Store: store, authenticator: auth.NewAuthenticator(store, secret)}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// RegisterRoutes adds the /api/journal routes to mux.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/journal/settings", httphandler.Func(s.getSettings))
	mux.Handle("PUT /api/journal/settings", httphandler.Func(s.putSettings))
	mux.Handle("GET /api/journal/reminder", httphandler.Func(s.getReminder))
	mux.Handle("PUT /api/journal/reminder", httphandler.Func(s.putReminder))
	mux.Handle("DELETE /api/journal/reminder", httphandler.Func(s.deleteReminder))
	mux.Handle("POST /api/journal/reminder/notifiers", httphandler.Func(s.listNotifiers))
	mux.Handle("POST /api/journal/reminder/test", httphandler.Func(s.sendTest))
}

var errNotSignedIn = &httphandler.Error{Code: http.StatusUnauthorized, Message: "sign in to use the journal"}

func (s *Service) currentUser(r *http.Request) (*store.User, error) {
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, errNotSignedIn
	}
	return user, nil
}

// currentUserFromBearer requires a Bearer token, so another site can't make a
// signed-in browser change anything with the session cookie alone.
func (s *Service) currentUserFromBearer(r *http.Request) (*store.User, error) {
	if auth.ExtractBearerToken(r.Header.Get("Authorization")) == "" {
		return nil, errNotSignedIn
	}
	return s.currentUser(r)
}

// settingsSpace is the one field of the settings the server reads: which
// Space holds the journal.
type settingsSpace struct {
	Space string `json:"space"`
}

func (s *Service) getSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	settings := json.RawMessage{}
	found, err := s.Store.GetUserRecord(r.Context(), store.UserRecordJournalSettings, user.ID, &settings)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the journal settings", Cause: err}
	}
	if !found {
		settings = json.RawMessage(`{}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(settings)
	return err
}

// putSettings stores the settings document the web app keeps. The server
// checks only that it is a JSON object of reasonable size with a valid Space.
func (s *Service) putSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSettingsBytes+1))
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	if len(body) > maxSettingsBytes {
		return &httphandler.Error{Code: http.StatusRequestEntityTooLarge, Message: "the journal settings are too large"}
	}
	object := map[string]json.RawMessage{}
	if err := json.Unmarshal(body, &object); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "the journal settings must be a JSON object", Cause: err}
	}
	space := settingsSpace{}
	if err := json.Unmarshal(body, &space); err != nil || (space.Space != "" && !spaceNamePattern.MatchString(space.Space)) {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid journal Space"}
	}
	compact := &bytes.Buffer{}
	if err := json.Compact(compact, body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	if err := s.Store.UpsertUserRecord(r.Context(), store.UserRecordJournalSettings, user.ID, json.RawMessage(compact.Bytes())); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the journal settings", Cause: err}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(compact.Bytes())
	return err
}

// Reminder is what the store keeps for a user's streak reminder.
type Reminder struct {
	Enabled bool `json:"enabled"`
	// URL is the user's Home Assistant.
	URL   string `json:"url"`
	Token string `json:"token"`
	// Notifier is the notify service, like "notify.mobile_app_phone".
	Notifier string `json:"notifier"`
	// Time is when to remind, "HH:MM" in Timezone.
	Time     string `json:"time"`
	Days     []int  `json:"days"`
	Timezone string `json:"timezone"`
	// OpenURL opens when the notification is tapped.
	OpenURL          string `json:"openUrl"`
	OnlyIfNotWritten bool   `json:"onlyIfNotWritten"`
	StreakWarning    bool   `json:"streakWarning"`
	// LastSent is the local date, "2006-01-02", the reminder last went or was
	// skipped, so it goes at most once a day.
	LastSent string `json:"lastSent,omitempty"`
}

// ReminderResponse is what a user sees of their reminder: never the token.
type ReminderResponse struct {
	Configured       bool   `json:"configured"`
	Enabled          bool   `json:"enabled"`
	URL              string `json:"url"`
	Notifier         string `json:"notifier"`
	Time             string `json:"time"`
	Days             []int  `json:"days"`
	Timezone         string `json:"timezone"`
	OpenURL          string `json:"openUrl"`
	OnlyIfNotWritten bool   `json:"onlyIfNotWritten"`
	StreakWarning    bool   `json:"streakWarning"`
}

// ReminderRequest saves the reminder. An empty Token keeps the saved one.
type ReminderRequest struct {
	Enabled          bool   `json:"enabled"`
	URL              string `json:"url"`
	Token            string `json:"token"`
	Notifier         string `json:"notifier"`
	Time             string `json:"time"`
	Days             []int  `json:"days"`
	Timezone         string `json:"timezone"`
	OpenURL          string `json:"openUrl"`
	OnlyIfNotWritten bool   `json:"onlyIfNotWritten"`
	StreakWarning    bool   `json:"streakWarning"`
}

func toReminderResponse(reminder *Reminder) ReminderResponse {
	if reminder == nil {
		return ReminderResponse{Days: []int{}}
	}
	days := reminder.Days
	if days == nil {
		days = []int{}
	}
	return ReminderResponse{
		Configured: true, Enabled: reminder.Enabled, URL: reminder.URL, Notifier: reminder.Notifier, Time: reminder.Time,
		Days: days, Timezone: reminder.Timezone, OpenURL: reminder.OpenURL,
		OnlyIfNotWritten: reminder.OnlyIfNotWritten, StreakWarning: reminder.StreakWarning,
	}
}

func (s *Service) loadReminder(ctx context.Context, userID int32) (*Reminder, error) {
	reminder := &Reminder{}
	found, err := s.Store.GetUserRecord(ctx, store.UserRecordJournalReminder, userID, reminder)
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to read the reminder", Cause: err}
	}
	if !found {
		return nil, nil
	}
	return reminder, nil
}

func (s *Service) getReminder(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUser(r)
	if err != nil {
		return err
	}
	reminder, err := s.loadReminder(r.Context(), user.ID)
	if err != nil {
		return err
	}
	return httphandler.JSON(w, http.StatusOK, toReminderResponse(reminder))
}

func badRequest(message string) error {
	return &httphandler.Error{Code: http.StatusBadRequest, Message: message}
}

// validate checks the request and returns the reminder to save.
func (request *ReminderRequest) validate() (*Reminder, error) {
	baseURL, err := homeassistant.NormalizeURL(request.URL)
	if err != nil {
		return nil, badRequest(err.Error())
	}
	if !homeassistant.IsNotifier(request.Notifier) {
		return nil, badRequest("choose a notifier")
	}
	if _, err := parseClock(request.Time); err != nil {
		return nil, badRequest("the time must be HH:MM")
	}
	seen := map[int]bool{}
	days := []int{}
	for _, day := range request.Days {
		if day < 0 || day > 6 {
			return nil, badRequest("days run from 0 (Sunday) to 6 (Saturday)")
		}
		if !seen[day] {
			seen[day] = true
			days = append(days, day)
		}
	}
	if _, err := time.LoadLocation(request.Timezone); err != nil || request.Timezone == "" {
		return nil, badRequest("unknown time zone")
	}
	openURL, err := url.Parse(strings.TrimSpace(request.OpenURL))
	if err != nil || (openURL.Scheme != "http" && openURL.Scheme != "https") || openURL.Host == "" {
		return nil, badRequest("the address to open must start with http:// or https://")
	}
	return &Reminder{
		Enabled: request.Enabled, URL: baseURL, Notifier: request.Notifier, Time: request.Time, Days: days,
		Timezone: request.Timezone, OpenURL: openURL.String(),
		OnlyIfNotWritten: request.OnlyIfNotWritten, StreakWarning: request.StreakWarning,
	}, nil
}

func (s *Service) putReminder(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	request := ReminderRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	reminder, err := request.validate()
	if err != nil {
		return err
	}
	saved, err := s.loadReminder(r.Context(), user.ID)
	if err != nil {
		return err
	}
	reminder.Token = strings.TrimSpace(request.Token)
	if reminder.Token == "" {
		if saved == nil || saved.Token == "" {
			return badRequest("enter a Home Assistant access token")
		}
		reminder.Token = saved.Token
	}
	if saved != nil {
		reminder.LastSent = saved.LastSent
	}
	client, err := homeassistant.NewClient(reminder.URL, reminder.Token, s.HTTPClient)
	if err != nil {
		return badRequest(err.Error())
	}
	// Save only a connection that works, at the address it ended up at.
	if err := client.Check(r.Context()); err != nil {
		return homeAssistantError(err)
	}
	reminder.URL = client.BaseURL()
	if err := s.Store.UpsertUserRecord(r.Context(), store.UserRecordJournalReminder, user.ID, reminder); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the reminder", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, toReminderResponse(reminder))
}

func (s *Service) deleteReminder(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	if err := s.Store.DeleteUserRecord(r.Context(), store.UserRecordJournalReminder, user.ID); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to remove the reminder", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, toReminderResponse(nil))
}

// NotifiersRequest names a Home Assistant to list notifiers from. An empty
// Token uses the saved one.
type NotifiersRequest struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

// NotifiersResponse lists the notify services, like "notify.mobile_app_phone".
type NotifiersResponse struct {
	Notifiers []string `json:"notifiers"`
}

// listNotifiers is a POST because its body can carry a token.
func (s *Service) listNotifiers(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	request := NotifiersRequest{}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxRequestBytes)).Decode(&request); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid request body", Cause: err}
	}
	token := strings.TrimSpace(request.Token)
	if token == "" {
		saved, err := s.loadReminder(r.Context(), user.ID)
		if err != nil {
			return err
		}
		if saved == nil {
			return badRequest("enter a Home Assistant access token")
		}
		token = saved.Token
	}
	client, err := homeassistant.NewClient(request.URL, token, s.HTTPClient)
	if err != nil {
		return badRequest(err.Error())
	}
	notifiers, err := client.Notifiers(r.Context())
	if err != nil {
		return homeAssistantError(err)
	}
	return httphandler.JSON(w, http.StatusOK, NotifiersResponse{Notifiers: notifiers})
}

func (s *Service) sendTest(w http.ResponseWriter, r *http.Request) error {
	user, err := s.currentUserFromBearer(r)
	if err != nil {
		return err
	}
	reminder, err := s.loadReminder(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if reminder == nil {
		return badRequest("save the reminder first")
	}
	client, err := homeassistant.NewClient(reminder.URL, reminder.Token, s.HTTPClient)
	if err != nil {
		return badRequest(err.Error())
	}
	notification := homeassistant.Notification{
		Title:       "WxNotes journal",
		Message:     "This is how your journal reminder will look. Tap it to open your journal.",
		URL:         reminder.OpenURL,
		ActionTitle: "Write now",
	}
	if err := client.Notify(r.Context(), reminder.Notifier, notification); err != nil {
		return homeAssistantError(err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// parseClock reads "HH:MM" as minutes after midnight.
func parseClock(value string) (int, error) {
	hours, minutes, ok := strings.Cut(value, ":")
	if !ok || len(hours) != 2 || len(minutes) != 2 {
		return 0, strconv.ErrSyntax
	}
	h, errHours := strconv.Atoi(hours)
	m, errMinutes := strconv.Atoi(minutes)
	if errHours != nil || errMinutes != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, strconv.ErrSyntax
	}
	return h*60 + m, nil
}

// homeAssistantError turns a failed Home Assistant call into an answer for
// the browser that says what went wrong and what to change.
func homeAssistantError(err error) error {
	return &httphandler.Error{Code: http.StatusBadGateway, Message: homeassistant.Explain(err), Cause: err}
}
