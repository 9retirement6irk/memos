package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestImmichConnectionStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	alice, err := createTestingUserWithRole(ctx, ts, "alice", store.RoleUser)
	require.NoError(t, err)
	bob, err := createTestingUserWithRole(ctx, ts, "bob", store.RoleUser)
	require.NoError(t, err)

	connection, err := ts.GetImmichConnection(ctx, alice.ID)
	require.NoError(t, err)
	require.Nil(t, connection)

	require.NoError(t, ts.UpsertImmichConnection(ctx, alice.ID, &store.ImmichConnection{URL: "http://immich.example.com:2283", APIKey: "first"}))
	require.NoError(t, ts.UpsertImmichConnection(ctx, alice.ID, &store.ImmichConnection{URL: "http://immich.example.com:2283", APIKey: "second"}))

	connection, err = ts.GetImmichConnection(ctx, alice.ID)
	require.NoError(t, err)
	require.Equal(t, &store.ImmichConnection{URL: "http://immich.example.com:2283", APIKey: "second"}, connection)

	// Each user has their own.
	connection, err = ts.GetImmichConnection(ctx, bob.ID)
	require.NoError(t, err)
	require.Nil(t, connection)

	require.NoError(t, ts.DeleteImmichConnection(ctx, alice.ID))
	connection, err = ts.GetImmichConnection(ctx, alice.ID)
	require.NoError(t, err)
	require.Nil(t, connection)
}

func TestImmichConnectionStaysOutOfInstanceSettings(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	require.NoError(t, ts.UpsertImmichConnection(ctx, user.ID, &store.ImmichConnection{URL: "http://immich.example.com", APIKey: "secret"}))

	// Listing every instance setting skips the row instead of failing on it.
	settings, err := ts.ListInstanceSettings(ctx, &store.FindInstanceSetting{})
	require.NoError(t, err)
	for _, setting := range settings {
		require.NotContains(t, setting.String(), "secret")
	}
}

func TestImmichConnectionGoesWithItsUser(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	user, err := createTestingUserWithRole(ctx, ts, "leaving", store.RoleUser)
	require.NoError(t, err)
	require.NoError(t, ts.UpsertImmichConnection(ctx, user.ID, &store.ImmichConnection{URL: "http://immich.example.com", APIKey: "secret"}))

	_, err = ts.DeleteUser(ctx, &store.DeleteUser{ID: user.ID})
	require.NoError(t, err)

	connection, err := ts.GetImmichConnection(ctx, user.ID)
	require.NoError(t, err)
	require.Nil(t, connection)
}
