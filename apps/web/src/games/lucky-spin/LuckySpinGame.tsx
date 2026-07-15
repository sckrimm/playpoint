import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw, Sparkles } from "lucide-react";
import { calculatePlayPoints, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type LuckySpinGameProps = {
  language: Language;
  onFinish: (result: GameResult) => void;
};

const durationSeconds = 10;
const sectors = [
  { label: "x1", points: 12, tone: "low" },
  { label: "x2", points: 20, tone: "mid" },
  { label: "Lucky", points: 38, tone: "hot" },
  { label: "x3", points: 26, tone: "mid" },
  { label: "Miss", points: -8, tone: "bad" },
  { label: "Bonus", points: 44, tone: "hot" }
];

export function LuckySpinGame({ language, onFinish }: LuckySpinGameProps) {
  const text = (key: string) => getText(language, key);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [angle, setAngle] = useState(0);
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
      gameId: "lucky-spin",
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

    let animationFrame = 0;
    const startedAt = Date.now();
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      setAngle((elapsedMs * 0.42) % 360);
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
    setAngle(0);
    setScore(0);
    setHits(0);
    setMisses(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    resultRef.current = { score: 0, hits: 0, misses: 0, accuracy: 0, maxCombo: 0 };
    setPlaying(true);
  };

  const stopWheel = () => {
    if (!playing || finished) return;

    const normalizedAngle = (360 - (angle % 360)) % 360;
    const sectorIndex = Math.floor(normalizedAngle / (360 / sectors.length)) % sectors.length;
    const sector = sectors[sectorIndex];
    const success = sector.points > 0;

    if (success) {
      setHits((value) => value + 1);
      setCombo((value) => {
        const nextCombo = value + 1;
        setMaxCombo((current) => Math.max(current, nextCombo));
        setScore((current) => current + sector.points + (nextCombo % 3 === 0 ? 18 : 0));
        return nextCombo;
      });
      return;
    }

    setMisses((value) => value + 1);
    setCombo(0);
    setScore((value) => Math.max(0, value + sector.points));
  };

  return (
    <section className="aim-hit-game lucky-spin-game">
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

      <div className="aim-hit-arena lucky-spin-arena">
        <span className="arena-grid" />
        <div className="spin-pointer" />
        <div className="spin-wheel" style={{ transform: `rotate(${angle}deg)` }}>
          {sectors.map((sector, index) => (
            <span className={`spin-sector ${sector.tone}`} key={sector.label} style={{ transform: `rotate(${index * 60}deg)` }}>
              {sector.label}
            </span>
          ))}
        </div>
        <button className="spin-stop-button" type="button" disabled={!playing || finished} onClick={stopWheel}>
          <Sparkles size={18} />
          {text("gameUi.stop")}
        </button>
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="lucky-spin-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <RotateCcw size={34} />
              </div>
              <span>Lucky Spin</span>
              <h2 id="lucky-spin-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.luckyIntro")}</p>
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
        <Sparkles size={16} />
        {text("gameUi.luckyTip")}
      </p>
    </section>
  );
}
