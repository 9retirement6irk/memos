package store

import (
	"context"
	"encoding/json"

	"github.com/pkg/errors"
)

// ForkSettingName names one of the fork's instance-wide settings: a small JSON
// document kept in its own system_setting row, like the per-user records in
// user_record.go but one for the whole instance. Stock Memos skips the row,
// because convertInstanceSettingFromRaw has no case for its name, so it stays
// out of every settings API and needs no schema change. Going back to stock
// Memos leaves the row unused; delete it to remove what it holds.
type ForkSettingName string

const (
	// ForkSettingTextExtraction holds the Claude connection and which AI reads
	// text out of images, drawings and PDFs.
	ForkSettingTextExtraction ForkSettingName = "FORK_TEXT_EXTRACTION"
)

// GetForkSetting decodes the setting into out. It reports false, leaving out
// alone, when the setting has never been saved.
func (s *Store) GetForkSetting(ctx context.Context, name ForkSettingName, out any) (bool, error) {
	list, err := s.driver.ListInstanceSettings(ctx, &FindInstanceSetting{Name: string(name)})
	if err != nil {
		return false, errors.Wrapf(err, "failed to read %s", name)
	}
	if len(list) == 0 {
		return false, nil
	}
	if err := json.Unmarshal([]byte(list[0].Value), out); err != nil {
		return false, errors.Wrapf(err, "failed to decode %s", name)
	}
	return true, nil
}

// UpsertForkSetting saves value as the setting, replacing any earlier one.
func (s *Store) UpsertForkSetting(ctx context.Context, name ForkSettingName, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return errors.Wrapf(err, "failed to encode %s", name)
	}
	if _, err := s.driver.UpsertInstanceSetting(ctx, &InstanceSetting{
		Name:        string(name),
		Value:       string(encoded),
		Description: "Fork setting",
	}); err != nil {
		return errors.Wrapf(err, "failed to save %s", name)
	}
	return nil
}
