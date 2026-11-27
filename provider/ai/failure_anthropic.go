package ai

import (
	stderrors "errors"
	"net/http"

	"github.com/usememos/memos/provider/ai/anthropic"
)

// anthropicFailures maps the Claude client's errors to what an administrator
// does about them. That client carries Anthropic's own message in its error
// text, which a Failure must not, so only the kind and the status are kept.
var anthropicFailures = []struct {
	err    error
	kind   FailureKind
	status int
}{
	{anthropic.ErrUnauthorized, FailureAuth, http.StatusUnauthorized},
	{anthropic.ErrForbidden, FailureAuth, http.StatusForbidden},
	{anthropic.ErrNotFound, FailureNotFound, http.StatusNotFound},
	{anthropic.ErrRateLimited, FailureRateLimited, http.StatusTooManyRequests},
	{anthropic.ErrOverloaded, FailureServer, 529},
	{anthropic.ErrBadRequest, FailureRejected, http.StatusBadRequest},
	{anthropic.ErrRefused, FailureResponse, 0},
	{anthropic.ErrIncomplete, FailureResponse, 0},
}

// anthropicFailure classifies an error from the Claude client, or reports false
// for any other error.
func anthropicFailure(err error) (Failure, bool) {
	for _, known := range anthropicFailures {
		if stderrors.Is(err, known.err) {
			return Failure{Kind: known.kind, Status: known.status}, true
		}
	}
	return Failure{}, false
}
