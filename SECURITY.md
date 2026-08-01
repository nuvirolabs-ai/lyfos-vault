# Security Policy

Lyfos handles sensitive family vault data. Please report security issues privately and give maintainers time to respond before public disclosure.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting for this repository when available.

If private reporting is unavailable, email:

`hello@nuvirolabs.com`

Use the subject:

`Security report for Lyfos Vault`

Please include:

- A clear description of the issue.
- Steps to reproduce.
- Affected files, routes, functions, or versions.
- The practical impact.
- Any proof-of-concept code needed to verify the issue.

Do not include real user vault data, production secrets, or private customer information.

## Scope

In scope:

- Free Forever Lyfos Vault code in this public repository.
- Local vault storage, encryption, backup, restore, and recovery-key behavior.
- Public Supabase Edge Function code included in this repository.
- Authentication, invite, waitlist, and static marketing code included here.

Out of scope:

- Denial-of-service testing.
- Social engineering.
- Physical attacks.
- Third-party services outside Nuviro Labs' control.
- Paid Vault private service code that is not present in this repository.

## Safe Testing Rules

- Do not access, modify, delete, or exfiltrate data that is not yours.
- Do not attempt persistence or lateral movement.
- Do not test against production users.
- Use a local development environment or your own test account.
- Stop testing and report immediately if you encounter sensitive data.

## Supported Versions

Security fixes are handled for the current `main` branch and the latest public release, when releases exist.

## Bounty

Lyfos does not currently offer a paid bug bounty. Responsible reports are still appreciated and will be credited when appropriate.

## Response Expectations

We aim to acknowledge valid reports within 7 days and provide a remediation plan or status update after triage.
