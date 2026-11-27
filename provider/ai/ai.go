package ai

// ProviderType identifies an AI provider implementation.
type ProviderType string

const (
	// ProviderOpenAI is OpenAI's hosted API.
	ProviderOpenAI ProviderType = "OPENAI"
	// ProviderGemini is Google's Gemini API.
	ProviderGemini ProviderType = "GEMINI"
	// ProviderAnthropic is Anthropic's Messages API, for Claude. It is the fork's:
	// the store's provider list has no such type, so it never comes from the
	// instance's AI setting, only from the fork's own Claude connection
	// (server/textextraction). It generates text; it does not transcribe.
	ProviderAnthropic ProviderType = "ANTHROPIC"
)

// ProviderConfig configures a callable AI provider connection.
type ProviderConfig struct {
	ID       string
	Title    string
	Type     ProviderType
	Endpoint string
	APIKey   string
}
