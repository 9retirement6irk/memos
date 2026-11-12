package immich

import "github.com/usememos/memos/internal/safehttp"

// service describes Immich for failure messages.
var service = safehttp.Service{
	Name:        "Immich",
	ExampleURL:  "http://192.168.1.20:2283",
	DefaultPort: "2283",
	KeyHelp:     "Check that it was copied whole and has the permissions listed below.",
}

// Explain says, for the person setting up the connection, why a call to Immich
// failed and what to change. It names only the server address they entered,
// never the API key.
func Explain(err error) string {
	return safehttp.Explain(err, service)
}
