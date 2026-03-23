# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, use [GitHub Security Advisories](https://github.com/naval-group/headlamp-kubevirt/security/advisories/new) to report privately.

You should receive a response within 48 hours.

## Security Practices

This plugin follows security best practices:

- Safe YAML parsing with `JSON_SCHEMA` to prevent code execution
- URL validation for user-provided inputs
- No sensitive data logging
- Container images run as non-root
- Minimal RBAC permissions
