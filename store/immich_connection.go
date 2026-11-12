package store

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"

	"github.com/pkg/errors"
)

// ImmichConnection is one user's link to their own Immich photo server: its
// address and the API key that reads it. The key never leaves the server.
//
// It is kept as a system_setting row named per user, like the configuration
// state record: the instance setting reads skip it, because
// convertInstanceSettingFromRaw has no case for its name. That keeps it out of
// every settings API and needs no schema change.
type ImmichConnection struct {
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
}

const immichConnectionPrefix = "IMMICH_CONNECTION_"

func immichConnectionName(userID int32) string {
	return immichConnectionPrefix + strconv.FormatInt(int64(userID), 10)
}

// GetImmichConnection returns the user's Immich connection, or nil when they
// have none.
func (s *Store) GetImmichConnection(ctx context.Context, userID int32) (*ImmichConnection, error) {
	list, err := s.driver.ListInstanceSettings(ctx, &FindInstanceSetting{Name: immichConnectionName(userID)})
	if err != nil {
		return nil, errors.Wrap(err, "failed to read Immich connection")
	}
	if len(list) == 0 {
		return nil, nil
	}
	connection := &ImmichConnection{}
	if err := json.Unmarshal([]byte(list[0].Value), connection); err != nil {
		return nil, errors.Wrap(err, "failed to decode Immich connection")
	}
	return connection, nil
}

// UpsertImmichConnection saves the user's Immich connection, replacing any
// earlier one.
func (s *Store) UpsertImmichConnection(ctx context.Context, userID int32, connection *ImmichConnection) error {
	value, err := json.Marshal(connection)
	if err != nil {
		return errors.Wrap(err, "failed to encode Immich connection")
	}
	if _, err := s.driver.UpsertInstanceSetting(ctx, &InstanceSetting{
		Name:        immichConnectionName(userID),
		Value:       string(value),
		Description: "Immich connection of one user",
	}); err != nil {
		return errors.Wrap(err, "failed to save Immich connection")
	}
	return nil
}

// DeleteImmichConnection removes the user's Immich connection, if any.
func (s *Store) DeleteImmichConnection(ctx context.Context, userID int32) error {
	if err := s.driver.DeleteInstanceSetting(ctx, &DeleteInstanceSetting{Name: immichConnectionName(userID)}); err != nil {
		return errors.Wrap(err, "failed to delete Immich connection")
	}
	return nil
}

// removeDeletedUserImmichConnection drops a deleted user's Immich key. The
// user is already gone, so a failure only leaves a row nothing reads.
func (s *Store) removeDeletedUserImmichConnection(ctx context.Context, userID int32) {
	if err := s.DeleteImmichConnection(ctx, userID); err != nil {
		slog.Warn("failed to remove deleted user's Immich connection", slog.Int("userID", int(userID)), slog.String("error", err.Error()))
	}
}
