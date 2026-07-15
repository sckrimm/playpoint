import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Target, Zap } from "lucide-react";
import { aimHitRules, calculatePlayPoints, type GameId, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type TargetPosition = {
  x: number;
  y: number;
  size: number;
};

type AimHitGameProps = {
  gameId?: GameId;
  language: Language;
  onFinish: (result: GameResult) => void;
};

function createTarget(): TargetPosition {
  return {
    x: 12 + Math.random() * 68,
    y: 12 + Math.random() * 62,
    size: 54 + Math.round(Math.random() * 18)
  };
}

export function AimHitGame({ gameId = "aim-hit", language, onFinish }: AimHitGameProps) {
  const text = (key: string) => getText(language, key);
  const [timeLeft, setTimeLeft] = useState<number>(aimHitRules.durationSeconds);
  const [target, setTarget] = useState<TargetPosition>(() => createTarget());
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const resultRef = useRef({
    score: 0,
    hits: 0,
    misses: 0,
    accuracy: 0,
    maxCombo: 0
  });

  const accuracy = useMemo(() => {
    const attempts = hits + misses;
    return attempts === 0 ? 0 : Math.round((hits / attempts) * 100);
  }, [hits, misses]);

  useEffect(() => {
    resultRef.current = { score, hits, misses, accuracy, maxCombo };
  }, [accuracy, hits, maxCombo, misses, score]);

  useEffect(() => {
    if (!playing || finished) return;

    const startedAt = Date.now();
    const durationMs = aimHitRules.durationSeconds * 1000;

    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const nextTimeLeft = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000));
      setTimeLeft(nextTimeLeft);

      if (elapsedMs >= durationMs) {
        window.clearInterval(timer);
        setFinished(true);
        const result = resultRef.current;
        onFinish({
          gameId,
          score: result.score,
          playPoints: calculatePlayPoints(result.score),
          durationSeconds: aimHitRules.durationSeconds,
          hits: result.hits,
          misses: result.misses,
          accuracy: result.accuracy,
          maxCombo: result.maxCombo
        });
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [finished, gameId, onFinish, playing]);

  const startGame = () => {
    setTimeLeft(aimHitRules.durationSeconds);
    setTarget(createTarget());
    setScore(0);
    setHits(0);
    setMisses(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    resultRef.current = {
      score: 0,
      hits: 0,
      misses: 0,
      accuracy: 0,
      maxCombo: 0
    };
    setPlaying(true);
  };

  const hitTarget = () => {
    if (!playing || finished) return;

    setHits((value) => value + 1);
    setCombo((value) => {
      const nextCombo = value + 1;
      setMaxCombo((current) => Math.max(current, nextCombo));
      setScore((currentScore) => {
        const comboBonus = nextCombo % aimHitRules.comboEveryHits === 0 ? aimHitRules.comboBonus : 0;
        return currentScore + aimHitRules.hitScore + comboBonus;
      });
      return nextCombo;
    });
    setTarget(createTarget());
  };

  const missTarget = () => {
    if (!playing || finished) return;
    setMisses((value) => value + 1);
    setCombo(0);
    setScore((value) => Math.max(0, value - aimHitRules.missPenalty));
  };

  return (
    <section className="aim-hit-game">
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

      <div className="aim-hit-arena" onClick={missTarget} aria-label="Aim Hit play area" role="presentation">
        <span className="arena-grid" />
        {playing ? (
          <button
            className="aim-target"
            type="button"
            style={{
              left: `${target.x}%`,
              top: `${target.y}%`,
              width: target.size,
              height: target.size
            }}
            onClick={(event) => {
              event.stopPropagation();
              hitTarget();
            }}
            aria-label="Hit target"
          >
            <Target size={Math.round(target.size * 0.58)} />
          </button>
        ) : null}
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="aim-hit-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <Zap size={34} />
              </div>
              <span>Aim Hit</span>
              <h2 id="aim-hit-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.aimIntro")}</p>
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

      <p className="aim-hit-tip">
        {text("gameUi.aimTipStart")} {aimHitRules.comboEveryHits} {text("gameUi.aimTipEnd")} +{aimHitRules.comboBonus}.
      </p>
    </section>
  );
}
