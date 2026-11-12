package safehttp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"

	"github.com/pkg/errors"
)

// Service names the kind of server a failure is explained for.
type Service struct {
	// Name is how people call the server, like "Immich".
	Name string
	// ExampleURL is an address of the usual shape, like "http://192.168.1.20:2283".
	ExampleURL string
	// DefaultPort is the port the server uses unless changed, like "2283".
	DefaultPort string
	// KeyName is what the server calls its credential; empty means "API key".
	KeyName string
	// KeyHelp follows the sentence that the key was refused, like "Check that
	// it has the permissions listed below." Empty says nothing more.
	KeyHelp string
}

// Explain says, for the person setting up a connection, why a call to the
// service failed and what to change. It names only the server address they
// entered, never the key.
func Explain(err error, service Service) string {
	host := failedHost(err)
	var (
		statusError   *StatusError
		blockedError  *BlockedAddressError
		redirectError *RedirectError
		dnsError      *net.DNSError
		unknownCA     x509.UnknownAuthorityError
		wrongHost     x509.HostnameError
		badCert       x509.CertificateInvalidError
		recordHeader  tls.RecordHeaderError
		netError      net.Error
	)
	switch {
	case errors.Is(err, ErrUnauthorized):
		keyName := service.KeyName
		if keyName == "" {
			keyName = "API key"
		}
		return strings.TrimSpace(fmt.Sprintf("%s refused the %s. %s", service.Name, keyName, service.KeyHelp))
	case errors.As(err, &blockedError):
		return fmt.Sprintf("From the Memos server, %s resolves to %s, which is the Memos server itself or a link-local address, "+
			"so Memos won't connect to it. Check the DNS the Memos server uses (a local DNS rewrite or an extra_hosts entry), "+
			"or enter the address of the machine %s runs on (like %s) "+
			"or the %s container's name if both run in the same Docker network.",
			blockedError.Host, blockedError.IP, service.Name, service.ExampleURL, service.Name)
	case errors.Is(err, ErrBlockedAddress):
		return fmt.Sprintf("%s points at the Memos server itself, so Memos won't connect to it. "+
			"Use the address of the machine %s runs on (like %s), "+
			"or the %s container's name if both run in the same Docker network.", host, service.Name, service.ExampleURL, service.Name)
	case errors.As(err, &redirectError):
		return fmt.Sprintf("That address redirects to %s, and Memos won't send your key to a different address. "+
			"Enter %s instead.", redirectError.Target, redirectError.Target)
	case errors.As(err, &statusError) && statusError.Code == http.StatusNotFound:
		return fmt.Sprintf("Something answered at that address, but not the %s API. "+
			"Use the address you open %s at in a browser, with nothing after the port.", service.Name, service.Name)
	case errors.As(err, &statusError):
		return fmt.Sprintf("%s answered with an error (HTTP %d). Check that the server is running properly.", service.Name, statusError.Code)
	case errors.Is(err, ErrUnexpectedAnswer):
		return fmt.Sprintf("Something answered at that address, but it isn't %s. "+
			"Use the address you open %s at in a browser, with nothing after the port.", service.Name, service.Name)
	case errors.As(err, &dnsError):
		return fmt.Sprintf("Memos couldn't find a server called %s. Check the spelling. "+
			"A Docker container name only works when Memos and %s are on the same Docker network.", dnsError.Name, service.Name)
	case errors.Is(err, syscall.ECONNREFUSED):
		return fmt.Sprintf("Nothing is listening at %s. Check the port: %s uses %s unless you changed it.", host, service.Name, service.DefaultPort)
	case errors.As(err, &unknownCA), errors.As(err, &wrongHost), errors.As(err, &badCert):
		return fmt.Sprintf("Memos doesn't trust the HTTPS certificate of %s. "+
			"Use its http:// address on your network, or give it a certificate from a public authority.", host)
	case errors.As(err, &recordHeader), strings.Contains(err.Error(), "server gave HTTP response to HTTPS client"):
		return fmt.Sprintf("%s speaks plain HTTP. Start the address with http:// instead of https://.", host)
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netError) && netError.Timeout():
		return fmt.Sprintf("%s didn't answer in time. Check that the Memos server can reach that network; "+
			"a firewall or VPN may be in the way.", host)
	case errors.Is(err, syscall.EHOSTUNREACH), errors.Is(err, syscall.ENETUNREACH):
		return fmt.Sprintf("The Memos server has no route to %s. Check that it can reach that network.", host)
	default:
		return fmt.Sprintf("%s could not be reached: %s", service.Name, errors.Cause(err).Error())
	}
}

// failedHost is the host:port a failed request was for, or "That address".
func failedHost(err error) string {
	var urlError *url.Error
	if errors.As(err, &urlError) {
		if parsed, parseErr := url.Parse(urlError.URL); parseErr == nil && parsed.Host != "" {
			return parsed.Host
		}
	}
	return "That address"
}
