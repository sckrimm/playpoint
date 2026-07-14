# PlayPoint Mobile Web MVP

PlayPoint is a mobile-first gamified engagement prototype where users register, play casual games, earn PlayPoints, compete on leaderboards, and redeem rewards from partner brands.

## Project Structure

```text
.
├── index.html                  # Root redirect to the prototype launcher
├── package.json                # Monorepo workspace scripts
├── tsconfig.base.json          # Shared TypeScript config
├── README.md                   # Project orientation
├── apps/
│   └── web/                    # React + TypeScript + Vite web MVP
├── docs/
│   ├── PRD.md                  # Product requirements
│   ├── MVP_ROADMAP.md          # MVP scope and execution plan
│   └── design/
│       └── VIBRANT_GAMIFIED_ENGAGEMENT.md
├── packages/
│   └── shared/                 # Shared types, constants, point rules, mock data
└── prototype/
    ├── index.html              # Clickable prototype launcher
    ├── shared/
    │   └── prototype-links.js  # Temporary static-screen routing
    └── screens/
        ├── splash/
        ├── phone-login/
        ├── otp-verification/
        ├── profile-setup/
        ├── home/
        ├── game-loading/
        ├── game-frame/
        ├── score-popup/
        ├── leaderboard-daily/
        ├── leaderboard-weekly/
        ├── rewards/
        ├── profile/
        └── edit-profile/
└── server/
    └── api/                    # Node.js TypeScript API scaffold
```

Each screen folder contains:

- `index.html` - the current static screen implementation.
- `screen.png` - visual reference exported with the original screen.

## How To Open

Open `index.html` from the project root, or open `prototype/index.html` directly.

## Development Stack

- Web MVP: React + TypeScript + Vite
- Future mobile app: React Native + Expo + TypeScript
- Backend: Node.js + TypeScript
- Database layer planned next: PostgreSQL + Redis
- Architecture: npm workspaces monorepo

## Local Development

This project expects Node.js 20+.

```bash
nvm use
npm install
npm run dev
```

Useful scripts:

```bash
npm run dev        # starts apps/web
npm run build      # typechecks and builds apps/web
npm run typecheck  # TypeScript check for apps/web
npm run lint       # ESLint for apps/web
```

## Current Flow

Splash -> Phone login -> OTP verification -> Profile setup -> Home -> Game loading -> Game frame -> Score popup -> Leaderboard / Rewards / Profile.

## Next Implementation Step

Keep the static prototype in `prototype/` as the pitch/demo reference. The real MVP starts in `apps/web`, while common product rules and API contracts live in `packages/shared`.
