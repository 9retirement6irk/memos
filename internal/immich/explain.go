package immich

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

// Explain says, for the person setting up the connection, why a call to Immich
// failed and what to change. It names only the server address they entered,
// never the API key.
func Explain(err error) string {
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
		return "Immich refused the API key. Check that it was copied whole and has the permissions listed below."
	case errors.As(err, &blockedError):
		return fmt.Sprintf("From the Memos server, %s resolves to %s, which is the Memos server itself or a link-local address, "+
			"so Memos won't connect to it. Check the DNS the Memos server uses (a local DNS rewrite or an extra_hosts entry), "+
			"or enter the address of the machine Immich runs on (like http://192.168.1.20:2283) "+
			"or the Immich container's name if both run in the same Docker network.", blockedError.Host, blockedError.IP)
	case errors.Is(err, ErrBlockedAddress):
		return fmt.Sprintf("%s points at the Memos server itself, so Memos won't connect to it. "+
			"Use the address of the machine Immich runs on (like http://192.168.1.20:2283), "+
			"or the Immich container's name if both run in the same Docker network.", host)
	case errors.As(err, &redirectError):
		return fmt.Sprintf("That address redirects to %s, and Memos won't send your API key to a different address. "+
			"Enter %s instead.", redirectError.Target, redirectError.Target)
	case errors.As(err, &statusError) && statusError.Code == http.StatusNotFound:
		return "Something answered at that address, but not the Immich API. " +
			"Use the address you open Immich at in a browser, with nothing after the port."
	case errors.As(err, &statusError):
		return fmt.Sprintf("Immich answered with an error (HTTP %d). Check that the server is running properly.", statusError.Code)
	case errors.Is(err, ErrNotImmich):
		return "Something answered at that address, but it isn't Immich. " +
			"Use the address you open Immich at in a browser, with nothing after the port."
	case errors.As(err, &dnsError):
		return fmt.Sprintf("Memos couldn't find a server called %s. Check the spelling. "+
			"A Docker container name only works when Memos and Immich are on the same Docker network.", dnsError.Name)
	case errors.Is(err, syscall.ECONNREFUSED):
		return fmt.Sprintf("Nothing is listening at %s. Check the port: Immich uses 2283 unless you changed it.", host)
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
		return "Immich could not be reached: " + strings.TrimPrefix(errors.Cause(err).Error(), "immich: ")
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
