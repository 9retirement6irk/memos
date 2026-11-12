package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

type sampleRecord struct {
	Space string `json:"space"`
}

func TestUserRecordStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	alice, err := createTestingUserWithRole(ctx, ts, "alice", store.RoleUser)
	require.NoError(t, err)
	bob, err := createTestingUserWithRole(ctx, ts, "bob", store.RoleUser)
	require.NoError(t, err)

	record := sampleRecord{}
	found, err := ts.GetUserRecord(ctx, store.UserRecordJournalSettings, alice.ID, &record)
	require.NoError(t, err)
	require.False(t, found)

	require.NoError(t, ts.UpsertUserRecord(ctx, store.UserRecordJournalSettings, alice.ID, sampleRecord{Space: "spaces/one"}))
	require.NoError(t, ts.UpsertUserRecord(ctx, store.UserRecordJournalSettings, alice.ID, sampleRecord{Space: "spaces/two"}))
	require.NoError(t, ts.UpsertUserRecord(ctx, store.UserRecordJournalReminder, bob.ID, sampleRecord{Space: "spaces/bob"}))

	found, err = ts.GetUserRecord(ctx, store.UserRecordJournalSettings, alice.ID, &record)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "spaces/two", record.Space)

	// Kinds and users don't mix.
	found, err = ts.GetUserRecord(ctx, store.UserRecordJournalSettings, bob.ID, &sampleRecord{})
	require.NoError(t, err)
	require.False(t, found)
	reminders, err := ts.ListUserRecords(ctx, store.UserRecordJournalReminder)
	require.NoError(t, err)
	require.Equal(t, map[int32]string{bob.ID: `{"space":"spaces/bob"}`}, reminders)

	// Records stay out of the instance settings.
	settings, err := ts.ListInstanceSettings(ctx, &store.FindInstanceSetting{})
	require.NoError(t, err)
	for _, setting := range settings {
		require.NotContains(t, setting.String(), "spaces/two")
	}

	// Deleting a user deletes their records.
	_, err = ts.DeleteUser(ctx, &store.DeleteUser{ID: bob.ID})
	require.NoError(t, err)
	reminders, err = ts.ListUserRecords(ctx, store.UserRecordJournalReminder)
	require.NoError(t, err)
	require.Empty(t, reminders)

	require.NoError(t, ts.DeleteUserRecord(ctx, store.UserRecordJournalSettings, alice.ID))
	found, err = ts.GetUserRecord(ctx, store.UserRecordJournalSettings, alice.ID, &record)
	require.NoError(t, err)
	require.False(t, found)
}
