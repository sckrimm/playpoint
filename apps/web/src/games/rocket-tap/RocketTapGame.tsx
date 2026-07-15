import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Rocket, Zap } from "lucide-react";
import { calculatePlayPoints, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type RocketTapGameProps = {
  language: Language;
  onFinish: (result: GameResult) => void;
};

const durationSeconds = 10;

function getPowerZone() {
  const start = 24 + Math.floor(Math.random() * 38);
  return { start, end: start + 18 };
}

export function RocketTapGame({ language, onFinish }: RocketTapGameProps) {
  const text = (key: string) => getText(language, key);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [power, setPower] = useState(0);
  const [zone, setZone] = useState(() => getPowerZone());
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const resultRef = useRef({ score: 0, hits: 0, misses: 0, accuracy: 0, maxCombo: 0 });

  const accuracy = useMemo(() => {
    const attempts = hits + misses;
    return attempts === 0 ? 0 : Math.round((hits / attempts) * 100);
  }, [hits, misses]);

  useEffect(() => {
    resultRef.current = { score, hits, misses, accuracy, maxCombo };
  }, [accuracy, hits, maxCombo, misses, score]);

  const finishGame = useCallback(() => {
    if (finished) return;
    setFinished(true);
    const result = resultRef.current;
    onFinish({
      gameId: "rocket-tap",
      score: result.score,
      playPoints: calculatePlayPoints(result.score),
      durationSeconds,
      hits: result.hits,
      misses: result.misses,
      accuracy: result.accuracy,
      maxCombo: result.maxCombo
    });
  }, [finished, onFinish]);

  useEffect(() => {
    if (!playing || finished) return;

    const startedAt = Date.now();
    let animationFrame = 0;
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const wave = (Math.sin(elapsedMs / 170) + 1) / 2;
      setPower(Math.round(wave * 100));
      setTimeLeft(Math.max(0, Math.ceil((durationSeconds * 1000 - elapsedMs) / 1000)));

      if (elapsedMs >= durationSeconds * 1000) {
        finishGame();
        return;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [finishGame, finished, playing]);

  const startGame = () => {
    setTimeLeft(durationSeconds);
    setPower(0);
    setZone(getPowerZone());
    setScore(0);
    setHits(0);
    setMisses(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    resultRef.current = { score: 0, hits: 0, misses: 0, accuracy: 0, maxCombo: 0 };
    setPlaying(true);
  };

  const launchRocket = () => {
    if (!playing || finished) return;

    if (power >= zone.start && power <= zone.end) {
      setHits((value) => value + 1);
      setCombo((value) => {
        const nextCombo = value + 1;
        setMaxCombo((current) => Math.max(current, nextCombo));
        setScore((current) => current + 22 + nextCombo * 4);
        return nextCombo;
      });
    } else {
      setMisses((value) => value + 1);
      setCombo(0);
      setScore((value) => Math.max(0, value - 7));
    }

    setZone(getPowerZone());
  };

  return (
    <section className="aim-hit-game rocket-tap-game">
      <div className="aim-hit-hud">
        <div>
          <span>{text("gameUi.score")}</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>{text("gameUi.time")}</span>
          <strong>00:{String(timeLeft).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>{text("gameUi.combo")}</span>
          <strong>x{combo}</strong>
        </div>
      </div>

      <div className="aim-hit-arena rocket-tap-arena">
        <span className="arena-grid" />
        <div className="rocket-stage">
          <Rocket className={hits > 0 ? "launched" : ""} size={76} />
          <span style={{ height: `${Math.max(16, power)}%` }} />
        </div>
        <div className="rocket-meter">
          <span className="rocket-zone" style={{ left: `${zone.start}%`, width: `${zone.end - zone.start}%` }} />
          <b style={{ left: `${power}%` }} />
        </div>
        <button className="rocket-launch-button" type="button" disabled={!playing || finished} onClick={launchRocket}>
          <Zap size={18} />
          {text("gameUi.launch")}
        </button>
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="rocket-tap-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <Rocket size={34} />
              </div>
              <span>Rocket Tap</span>
              <h2 id="rocket-tap-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.rocketIntro")}</p>
              <button className="primary-action" type="button" onClick={startGame}>
                <Play size={18} />
                {text("gameUi.start")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="aim-hit-footer">
        <div>
          <span>{text("score.hits")}</span>
          <strong>{hits}</strong>
        </div>
        <div>
          <span>{text("score.misses")}</span>
          <strong>{misses}</strong>
        </div>
        <div>
          <span>{text("score.accuracy")}</span>
          <strong>{accuracy}%</strong>
        </div>
      </div>

      <p className="aim-hit-tip color-rush-tip">
        <Zap size={16} />
        {text("gameUi.rocketTip")}
      </p>
    </section>
  );
}
