# PlayPoint — Product Requirements Document (PRD)

## 1. Project Overview
PlayPoint is a mobile-first gamified engagement platform designed to connect brands with users through casual gaming. Users play simple games, earn "PlayPoints," compete on leaderboards, and redeem points for real-world rewards.

**Vision:** Transform traditional digital advertising into a voluntary, high-retention gaming experience where brands are integrated into the gameplay and reward cycle.

---

## 2. Target Audience
### 2.1 Users
*   **Demographics:** 16–35 years old.
*   **Behavior:** Active mobile users, casual gamers, prize-motivated.
*   **Archetypes:** Students, office workers looking for quick breaks, social media enthusiasts.

### 2.2 Brands
*   **Categories:** FMCG (Fast-Moving Consumer Goods), Food & Beverage, Entertainment, Electronics, Lifestyle.
*   **Goal:** Seek high-quality engagement, brand recall, and direct conversion via digital vouchers.

---

## 3. Core Features (MVP)

### 3.1 Onboarding & Authentication
*   **Phone Login:** Simple entry via mobile number.
*   **OTP Verification:** Secure 4-digit SMS verification.
*   **Profile Setup:** Basic name and avatar configuration to start earning.

### 3.2 Gaming & Scoring
*   **Casual Game Library:** Initial library of 3 games (Snake, Memory, Aim Hit).
*   **Scoring Logic:** Game scores convert to PlayPoints (e.g., 100 Score = 10 Points).
*   **Attempt Limits:** 3 attempts per game per day to ensure fairness and daily return.

### 3.3 Competition (Leaderboards)
*   **Daily Leaderboard:** Resets every 24 hours for quick competition.
*   **Weekly Leaderboard:** The primary competitive drive where top players win sponsored grand prizes.
*   **Brand Sponsorship:** Leaderboards are "Presented by" partner brands.

### 3.4 Rewards Hub
*   **Reward Catalog:** Grid of available prizes with point requirements.
*   **Redemption Flow:** Detail view with claim confirmation and voucher generation.
*   **Claim History:** Tracking used vs. active rewards in the user profile.

### 3.5 Brand Integration (Ad Placements)
*   **Home Banners:** High-visibility promotional spots.
*   **Loading Banners:** "Interruptive" but native brand exposure during game initialization.
*   **Sponsored Rewards:** Direct product placement in the rewards catalog.

---

## 4. User Journey
1.  **Entry:** User opens app -> Splash -> Phone Auth.
2.  **Play:** User selects a game from Home -> Branded Loading -> Gameplay -> Score Popup.
3.  **Compete:** User checks rank on Daily/Weekly Leaderboard.
4.  **Redeem:** User accumulates points -> Rewards Screen -> Claims Coffee/Voucher.

---

## 5. Design System & Brand Identity
*   **Aesthetic:** Vibrant, gamified, "2D Flat" style.
*   **Color Palette:** Primary Blue (#6366f1) with energetic accents (Green, Yellow, Purple).
*   **Typography:** Montserrat (Clean, modern, readable).
*   **Components:** High-radius corners (16px+), soft shadows, and large interactive touch targets.

---

## 6. Success Metrics (KPIs)
*   **DAU/WAU:** Daily and Weekly Active Users.
*   **Retention:** Day 1 and Day 7 return rates.
*   **Engagement:** Average games played per session.
*   **Brand Value:** Banner CTR (Click-Through Rate) and Reward Claim Rate.

---

## 7. Technical Requirements (High-Level)
*   **Mobile-First Web / PWA:** For rapid deployment and cross-platform accessibility.
*   **Real-time Leaderboard:** Redis-backed ranking system for low-latency updates.
*   **Secure Backend:** Score validation to prevent cheating/tampering.
