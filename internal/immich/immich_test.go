package immich

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const testPhotoID = "6a2a5b0e-3c8d-4a1f-9c7e-1d2b3c4d5e6f"

func TestNormalizeURL(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]string{
		"http://immich.local:2283":        "http://immich.local:2283",
		"https://photos.example.com/":     "https://photos.example.com",
		"https://photos.example.com/api":  "https://photos.example.com",
		"https://example.com/immich/api/": "https://example.com/immich",
		"  http://192.168.1.20:2283/  ":   "http://192.168.1.20:2283",
	} {
		got, err := NormalizeURL(input)
		require.NoError(t, err, input)
		require.Equal(t, want, got, input)
	}
	for _, input := range []string{"", "immich.local", "ftp://immich.local", "http://user:pass@immich.local", "http://immich.local/?a=1", "http://immich.local/#x"} {
		_, err := NormalizeURL(input)
		require.Error(t, err, input)
	}
}

func TestDefaultClientRefusesLoopback(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "key", nil)
	require.NoError(t, err)
	_, err = client.CurrentUser(context.Background())
	require.ErrorContains(t, err, "not allowed")
}

// fakeImmich answers the endpoints the client calls, checking the API key.
func fakeImmich(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	authorized := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-api-key") != "good-key" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("GET /api/users/me", authorized(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"id":"u1","name":"Will","email":"will@example.com"}`)
	}))
	mux.HandleFunc("GET /api/albums", authorized(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"a1","albumName":"Garden","assetCount":2,"albumThumbnailAssetId":"`+testPhotoID+`"}]`)
	}))
	mux.HandleFunc("POST /api/search/metadata", authorized(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "IMAGE", body["type"])
		if body["takenAfter"] != nil {
			require.Equal(t, "asc", body["order"])
			require.Equal(t, true, body["withExif"])
			require.Equal(t, "2026-11-11T05:00:00Z", body["takenAfter"])
			require.Equal(t, "2026-11-12T05:00:00Z", body["takenBefore"])
			_, _ = io.WriteString(w, `{"assets":{"items":[{"id":"`+testPhotoID+`","originalFileName":"IMG_2.jpg","originalMimeType":"image/jpeg","localDateTime":"2026-11-11T14:14:00.000Z","exifInfo":{"latitude":42.3,"longitude":-71.12,"city":"Boston","dateTimeOriginal":"2026-11-11T19:14:00.000Z"}}],"nextCursor":null}}`)
			return
		}
		require.Equal(t, "desc", body["order"])
		if body["cursor"] == "abc" {
			_, _ = io.WriteString(w, `{"assets":{"items":[],"nextCursor":null}}`)
			return
		}
		_, _ = io.WriteString(w, `{"assets":{"items":[{"id":"`+testPhotoID+`","originalFileName":"IMG_1.jpg","originalMimeType":"image/jpeg","localDateTime":"2026-11-01T10:00:00.000Z","width":4032,"height":3024}],"nextCursor":"abc"}}`)
	}))
	mux.HandleFunc("GET /api/assets/{id}/thumbnail", authorized(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "thumbnail", r.URL.Query().Get("size"))
		w.Header().Set("Content-Type", "image/webp")
		_, _ = io.WriteString(w, "thumb")
	}))
	mux.HandleFunc("GET /api/assets/{id}/original", authorized(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = io.WriteString(w, "original")
	}))
	return httptest.NewServer(mux)
}

func TestClient(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	server := fakeImmich(t)
	defer server.Close()

	client, err := NewClient(server.URL+"/api/", "good-key", server.Client())
	require.NoError(t, err)

	user, err := client.CurrentUser(ctx)
	require.NoError(t, err)
	require.Equal(t, "u1", user.ID)

	albums, err := client.Albums(ctx)
	require.NoError(t, err)
	require.Equal(t, []Album{{ID: "a1", Name: "Garden", AssetCount: 2, ThumbnailAssetID: testPhotoID}}, albums)

	page, err := client.SearchPhotos(ctx, "", "")
	require.NoError(t, err)
	require.Len(t, page.Photos, 1)
	require.Equal(t, "IMG_1.jpg", page.Photos[0].FileName)
	require.Equal(t, "c:abc", page.Next)

	last, err := client.SearchPhotos(ctx, "", page.Next)
	require.NoError(t, err)
	require.Empty(t, last.Photos)
	require.Empty(t, last.Next)

	thumbnail, err := client.Thumbnail(ctx, testPhotoID)
	require.NoError(t, err)
	defer thumbnail.Body.Close()
	body, err := io.ReadAll(thumbnail.Body)
	require.NoError(t, err)
	require.Equal(t, "thumb", string(body))

	day, err := client.PhotosTaken(ctx, time.Date(2026, 11, 11, 0, 0, 0, 0, time.FixedZone("EST", -5*3600)), time.Date(2026, 11, 12, 0, 0, 0, 0, time.FixedZone("EST", -5*3600)), "")
	require.NoError(t, err)
	require.Len(t, day.Photos, 1)
	require.NotNil(t, day.Photos[0].Exif)
	require.InDelta(t, 42.3, *day.Photos[0].Exif.Latitude, 0.0001)
	require.Equal(t, "Boston", *day.Photos[0].Exif.City)
	_, err = client.PhotosTaken(ctx, time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC), time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC), "")
	require.ErrorContains(t, err, "time range is empty")

	original, err := client.Original(ctx, "../users/me")
	if original != nil {
		original.Body.Close()
	}
	require.ErrorContains(t, err, "invalid asset ID")
	_, err = client.SearchPhotos(ctx, "not-an-id", "")
	require.ErrorContains(t, err, "invalid album ID")
}

func TestClientRejectsWrongKey(t *testing.T) {
	t.Parallel()
	server := fakeImmich(t)
	defer server.Close()

	client, err := NewClient(server.URL, "wrong-key", server.Client())
	require.NoError(t, err)
	_, err = client.CurrentUser(context.Background())
	require.ErrorIs(t, err, ErrUnauthorized)
}
