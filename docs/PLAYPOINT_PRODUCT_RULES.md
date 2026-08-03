# PlayPoint Product Rules

This document captures the working product, economy, legal, and game-design rules for PlayPoint. It is a product reference, not final legal advice. Legal wording and compliance details must be reviewed by a qualified lawyer before production-scale campaigns.

## Economy Model

PlayPoint has two separate balances.

### Season Score

Season Score is the current monthly activity score.

- It is earned from games, missions, partner engagement, profile actions, referrals, quizzes, and similar product activity.
- It shows how active or strong a user was during the current season/month.
- It can drive leaderboard ranking, campaign ranking, premium item eligibility, or access tiers.
- It resets to `0` at the beginning of each new month/season.
- It is not directly spendable in the market.

### Market Coins

Market Coins are the spendable market currency.

- Users spend Market Coins in the market to claim rewards, vouchers, or items.
- Market Coins do not reset monthly.
- Market Coins can have an expiry window, for example `60-90` days.
- Market Coins are not money, cannot be exchanged for money, cannot be transferred between users, and cannot be purchased with money.
- Activities should not directly grant Market Coins in the main model.

### Main Flow

```text
Activity -> Season Score -> Monthly conversion -> Market Coins -> Reward claim -> Coins burn
```

Recommended MVP conversion:

```text
10 Season Score = 1 Market Coin
Monthly Season Score cap = 10,000
Maximum monthly conversion = 1,000 Market Coins
```

This keeps market supply predictable and avoids double-generation of spendable currency.

### Monthly Conversion Runbook

MVP conversion is intentionally manual before adding an automated cron job.

At the end of a season/month:

1. Run a dry run and check the totals.
2. Run the real conversion for that same `YYYY-MM` season.
3. Confirm users have `seasonScore = 0` and increased `marketCoins`.

Railway API shell commands:

```bash
cd /app
npm run api:season:convert -- --dry-run --season=2026-07
npm run api:season:convert -- --season=2026-07
```

The conversion is protected by a per-user/per-season ledger entry in `SeasonConversion`, so the same user cannot be converted twice for the same season. The conversion script:

- reads current `User.seasonScore`;
- converts up to the monthly cap;
- adds awarded coins to `User.marketCoins`;
- resets `User.seasonScore` to `0`;
- stores the audit row with the original score, converted score, rate, cap, and awarded coins.

Converted Market Coins are also stored as ledger lots in `MarketCoinTransaction` with a `90` day expiry window. Reward claims spend Market Coins from the earliest-expiring lots first.

Market Coins expiry can be run manually:

```bash
cd /app
npm run api:market-coins:expire -- --dry-run
npm run api:market-coins:expire
```

The expiry script burns only unspent, expired Market Coin lots and writes an `expired` ledger row for audit.

### Current Product Direction

- Games award Season Score, not Market Coins.
- Daily bonuses award Season Score, not Market Coins.
- Referral bonuses award Season Score, not Market Coins.
- Profile completion awards Season Score, not Market Coins.
- Partner/reward card engagement awards Season Score, not Market Coins.
- Market purchases spend Market Coins.
- Monthly conversion is the only normal way Season Score becomes Market Coins.

## User Data Model

### Registration

Recommended MVP registration flow:

- Phone number is required.
- OTP verification is required.
- Nickname/display name is required and public.
- Email is optional.
- Marketing consent is optional and separate from Terms acceptance.
- Personal ID is not required during registration.

The registration screen should include a short privacy notice before or at data collection time.

Example short notice:

```text
We use your phone number for registration, account security, and winner notifications. Your nickname and score may appear publicly on the leaderboard. See the Privacy Policy for details.
```

### Public User Data

Only these should be public:

- Nickname
- Avatar, if selected by the user
- Score
- Rank

### Data Not To Collect By Default

Do not collect unless clearly necessary:

- Personal ID during registration
- Full birth date if age confirmation is enough
- Address unless physical delivery is needed
- Bank details unless there is a cash prize
- Exact location unless the campaign depends on location
- Social contacts
- ID document photos
- Full social profile data

### Winner Verification

Winner-only data may be collected separately when required:

- Full name
- Contact phone
- Prize delivery details
- Personal ID only if legally/accounting-wise justified
- Prize handover confirmation

Winner personal ID, if ever collected, should be stored separately from the regular profile, encrypted, masked in admin UI, and access-logged.

## Consent And Profile Controls

The profile area should allow users to:

- Change nickname.
- Add or change email.
- Turn marketing consent on/off.
- Log out.
- Request access to their data.
- Request correction/deletion.
- Contact support.

Account deletion copy must not promise instant deletion if backup/security/legal retention applies.

Preferred wording:

```text
Your main account will be deleted after request processing. Some information may be temporarily retained for legal requirements, dispute resolution, and security purposes.
```

## Legal And Policy Documents

PlayPoint should have at least:

- Privacy Policy
- Terms & Conditions
- Campaign Rules per campaign/game/brand activation

### Privacy Policy Must Explain

- PlayPoint owner/operator
- Contact email
- What data is collected
- Why each data point is used
- Whether the data is required or optional
- Who data may be shared with
- Whether data may be stored or processed outside Georgia
- Retention periods
- User access/correction/deletion rights
- Complaint/contact process

### Terms & Conditions Must Explain

- Who can register
- Age restriction
- Daily attempt limits
- Score calculation
- Prohibited behavior
- Anti-cheat checks
- Account blocking rules
- Winner selection method
- Prize details
- Prize delivery/responsibility
- Claim deadlines
- Tie-break rules
- Score cancellation rules
- Partner brand responsibility

Score cancellation or account blocking must be based on a documented reason.

### Campaign Rules Must Explain

Each branded campaign should have short rules:

- Organizer
- Sponsor
- Exact start and end time
- Prize list
- Participation conditions
- Winner selection method
- Tie-break method
- Result verification window
- Prize claim flow
- Campaign-specific data use

## Age And Minors

MVP can use:

```text
I confirm that I am 18 years or older.
```

This is not strong age verification. Stronger verification becomes important if PlayPoint runs campaigns involving alcohol, tobacco, gambling, or other age-restricted products.

If users under 16 are allowed, parental consent mechanisms and child-data safeguards must be considered.

## Game And Prize Legal Risk

The safest PlayPoint model is skill-based competition.

Safer:

```text
The weekly winner is the user with the highest score in a skill-based game.
```

Riskier:

```text
A random winner is selected from all players at the end of the week.
```

Avoid high-risk mechanics unless reviewed:

- Spin-to-win wheels
- Random prize boxes
- Random winner selection
- Paid attempts
- Paid registration
- Paying money for points/coins that can become rewards
- Any wager/stake
- Chance elements that determine the final winner

Technical randomness inside a skill game can exist only if it does not dominate the outcome. For tournament/campaign mode, prefer equal maps/seeds/scenarios, documented scoring, and audit trails.

## Data Retention Working Model

These are working assumptions and should be reviewed:

| Data | Working retention |
| --- | --- |
| Active account data | While account is active |
| Inactive account | About 24 months after last activity |
| OTP technical records | About 3-6 months |
| Game results | Campaign period plus 6-12 months |
| Anti-cheat logs | About 12 months |
| IP/device security logs | About 6-12 months |
| Marketing consent | While marketing continues |
| Consent withdrawal record | 1 year after marketing stops |
| Winner documents | Required legal/accounting period |
| Deleted account backups | Short technical cycle, e.g. 30-90 days |

## Security Baseline

Minimum technical expectations:

- HTTPS everywhere.
- Rate limits for OTP and auth.
- Control multiple accounts per phone.
- Strong admin passwords and 2FA.
- Role-based access control.
- Access/action audit logs for sensitive data.
- Production data should not be copied to test environments.
- Use fictional/anonymized data for testing.
- Avoid exporting personal data through unsafe channels.
- Automated backups.
- Backup restore testing.
- Immediate access removal for former employees.

## Brand Data Sharing

Brands may see aggregated analytics:

- Player count
- Game count
- Average score
- Average session time
- Returning user rate
- Campaign views
- Reward claim status
- Aggregated region/age data if it cannot identify a person

Brands should not automatically receive:

- Phone numbers
- Emails
- Personal IDs
- Full user-level game history
- Individual interest profiles

Pseudonymous IDs can still be personal data if the brand can identify the person using other information.

## Internal Processing Register

PlayPoint should keep an internal processing register covering:

- Process
- Data category
- Purpose
- Legal basis
- Recipient
- Retention
- Security measures
- International transfers
- Incidents

Example:

| Process | Data | Purpose | Basis | Recipient | Retention |
| --- | --- | --- | --- | --- | --- |
| Registration | Phone | Account creation | Service performance | SMS provider | Account lifetime |
| Profile | Nickname | Public leaderboard | Service performance | App users | Account lifetime |
| Security | IP/device | Fraud prevention | Legitimate interest | Hosting/security provider | 12 months |
| Marketing | Phone/email | Offers | Consent | SMS/email provider | Until consent withdrawal |
| Prize handover | Name, personal ID if required | Winner identification | Law/contract | Accounting/sponsor | Required period |

## Incident Response

Incidents include:

- Database breach
- Wrong recipient data disclosure
- Lost export file
- Unauthorized admin access
- Public exposure of personal IDs
- Accidental deletion
- Unauthorized employee access

PlayPoint should maintain an incident response plan defining:

- Who receives incident reports
- Who blocks access
- Who assesses affected data
- Who contacts the authority if required
- Who prepares user notices if required
- How evidence is preserved

## DPO And DPIA

MVP likely does not require a full-time Data Protection Officer if processing stays limited.

Reassess if PlayPoint:

- Processes very large user volumes
- Performs large-scale behavior monitoring
- Builds detailed interest profiles for brands
- Runs large-scale profiling or automated decision-making

A short internal risk assessment is still recommended, especially for:

- Phone data breach
- Personal ID breach if collected for winners
- Leaderboard identifiability
- False positive anti-cheat blocking
- Employee access to winner data

## Implementation Implications

Planned future implementation should move toward:

- Rename current public points UI into Season Score where appropriate.
- Rename/spend `coins` as Market Coins.
- Keep leaderboard on Season Score.
- Keep market claims on Market Coins.
- Add monthly conversion logic.
- Add coin expiry if adopted.
- Add Terms/Privacy acceptance version fields.
- Add marketing consent field and profile toggle.
- Add account deletion/support request flows.
- Add campaign-specific rules model.
- Avoid random reward/winner mechanics unless legally reviewed.
