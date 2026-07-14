# PlayPoint MVP Roadmap

## Prototype Goal

PlayPoint MVP should prove one core loop:

1. User registers with phone and OTP.
2. User creates a profile and receives a starter bonus.
3. User opens the dashboard and plays a simple sponsored game.
4. Game score converts into PlayPoints.
5. User sees rank movement on daily/weekly leaderboards.
6. User redeems points for a partner voucher.

## Current Prototype Screens

- `prototype/index.html` - common prototype launcher and screen map.
- `prototype/screens/splash/index.html` - app entry.
- `prototype/screens/phone-login/index.html` - phone login.
- `prototype/screens/otp-verification/index.html` - OTP verification.
- `prototype/screens/profile-setup/index.html` - profile setup and registration bonus.
- `prototype/screens/home/index.html` - game dashboard.
- `prototype/screens/game-loading/index.html` - sponsor exposure before gameplay.
- `prototype/screens/game-frame/index.html` - game container.
- `prototype/screens/score-popup/index.html` - score and points result.
- `prototype/screens/leaderboard-daily/index.html` - daily competition.
- `prototype/screens/leaderboard-weekly/index.html` - weekly competition.
- `prototype/screens/rewards/index.html` - reward catalog.
- `prototype/screens/profile/index.html` - user stats and reward history.
- `prototype/screens/edit-profile/index.html` - profile settings.

## MVP Scope

### Must Have

- Mobile-first web prototype with a complete linked user journey.
- Phone/OTP registration mock or real auth provider.
- 3 games for launch: Snake, Memory, Aim Hit.
- Point rules: registration bonus, login bonus, daily game attempts, score conversion.
- Daily and weekly leaderboards.
- Reward catalog with voucher claim flow.
- Basic profile, point balance, claim history.
- Sponsor placements on home, game loading, rewards, and leaderboard.

### Should Have

- PWA install support.
- Admin seed data for brands, rewards, and campaigns.
- Fraud guard basics: attempt limits, server-side score validation, cooldowns.
- Event analytics: signup, game start, game finish, reward claim, sponsor click.
- Simple Georgian and English copy readiness.

### Later

- Real SMS OTP billing integration.
- Partner dashboard.
- Payment or invoicing flow for sponsors.
- Push notifications and streak campaigns.
- Advanced anti-cheat and device trust.

## Technical Plan

### Phase 1 - Clickable Investor Prototype

- Keep static HTML screens.
- Use `prototype/index.html` as the main demo entry.
- Use `prototype/shared/prototype-links.js` to connect existing screens.
- Add missing reward detail and voucher success screens if needed for the pitch.

### Phase 2 - Frontend App

- Move screens into a real app router.
- Recommended stack: React + Vite or Next.js, depending on backend/deploy choice.
- Extract shared design tokens, bottom navigation, top app bar, reward cards, leaderboard rows.
- Replace static page-to-page mocks with stateful flows.

### Phase 3 - MVP Backend

- Users: phone, display name, avatar, point balance.
- Games: daily attempts, score submissions, point conversion.
- Leaderboards: daily and weekly ranking snapshots.
- Rewards: catalog, inventory, claims, voucher codes.
- Sponsors: campaigns, placements, tracking links.

### Phase 4 - Launch Readiness

- Deploy PWA.
- Connect SMS provider.
- Add analytics dashboard.
- Load test leaderboard and score submission.
- Prepare pitch demo data and partner reward examples.

## Open Decisions

- Initial target market and legal age limits.
- Whether MVP uses real SMS OTP or mock OTP for pilot.
- Which 3 sponsor categories are best for first pitch.
- Voucher fulfillment model: manual codes, partner API, or generated promo codes.
- Point economy: conversion rate, daily limits, expiration, and fraud policy.
