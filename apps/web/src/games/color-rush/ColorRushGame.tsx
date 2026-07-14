import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Palette, Play, Zap } from "lucide-react";
import { calculatePlayPoints, colorRushRules, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type RushColor = {
  id: string;
  label: string;
  value: string;
  textColor: string;
};

type ColorRushGameProps = {
  language: Language;
  onFinish: (result: GameResult) => void;
};

const colors: RushColor[] = [
  { id: "blue", label: "Blue", value: "#4648d4", textColor: "#ffffff" },
  { id: "green", label: "Green", value: "#00a85a", textColor: "#ffffff" },
  { id: "yellow", label: "Yellow", value: "#ffca3a", textColor: "#3a2600" },
  { id: "red", label: "Red", value: "#ff4d5a", textColor: "#ffffff" },
  { id: "purple", label: "Purple", value: "#8b5cf6", textColor: "#ffffff" },
  { id: "orange", label: "Orange", value: "#ff8a3d", textColor: "#3a1600" }
];

function shuffleColors() {
  return [...colors].sort(() => Math.random() - 0.5);
}

function getRandomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

export function ColorRushGame({ language, onFinish }: ColorRushGameProps) {
  const text = (key: string) => getText(language, key);
  const [timeLeft, setTimeLeft] = useState<number>(colorRushRules.durationSeconds);
  const [options, setOptions] = useState<RushColor[]>(() => shuffleColors());
  const [targetColor, setTargetColor] = useState<RushColor>(() => getRandomColor());
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

  const finishGame = useCallback(() => {
    if (finished) return;
    setFinished(true);
    const result = resultRef.current;
    onFinish({
      gameId: "color-rush",
      score: result.score,
      playPoints: calculatePlayPoints(result.score),
      durationSeconds: colorRushRules.durationSeconds,
      hits: result.hits,
      misses: result.misses,
      accuracy: result.accuracy,
      maxCombo: result.maxCombo
    });
  }, [finished, onFinish]);

  useEffect(() => {
    if (!playing || finished) return;

    const startedAt = Date.now();
    const durationMs = colorRushRules.durationSeconds * 1000;

    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const nextTimeLeft = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000));
      setTimeLeft(nextTimeLeft);

      if (elapsedMs >= durationMs) {
        window.clearInterval(timer);
        finishGame();
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [finishGame, finished, playing]);

  const nextRound = () => {
    setTargetColor(getRandomColor());
    setOptions(shuffleColors());
  };

  const startGame = () => {
    setTimeLeft(colorRushRules.durationSeconds);
    setOptions(shuffleColors());
    setTargetColor(getRandomColor());
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

  const chooseColor = (color: RushColor) => {
    if (!playing || finished) return;

    if (color.id === targetColor.id) {
      setHits((value) => value + 1);
      setCombo((value) => {
        const nextCombo = value + 1;
        setMaxCombo((current) => Math.max(current, nextCombo));
        setScore((currentScore) => {
          const comboBonus = nextCombo % colorRushRules.comboEveryHits === 0 ? colorRushRules.comboBonus : 0;
          return currentScore + colorRushRules.hitScore + comboBonus;
        });
        return nextCombo;
      });
      nextRound();
      return;
    }

    setMisses((value) => value + 1);
    setCombo(0);
    setScore((value) => Math.max(0, value - colorRushRules.missPenalty));
  };

  return (
    <section className="aim-hit-game color-rush-game">
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

      <div className="aim-hit-arena color-rush-arena" aria-label="Color Rush play area">
        <span className="arena-grid" />
        <div className="color-target-card">
          <span>{text("gameUi.tapColor")}</span>
          <strong style={{ color: targetColor.value }}>{text(`color.${targetColor.id}`)}</strong>
        </div>
        <div className="color-rush-grid">
          {options.map((color) => (
            <button
              className="color-rush-button"
              key={color.id}
              style={{ background: color.value, color: color.textColor }}
              type="button"
              onClick={() => chooseColor(color)}
            >
              {text(`color.${color.id}`)}
            </button>
          ))}
        </div>
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="color-rush-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <Palette size={34} />
              </div>
              <span>Color Rush</span>
              <h2 id="color-rush-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.colorIntro")}</p>
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
          <span>{text("gameUi.correct")}</span>
          <strong>{hits}</strong>
        </div>
        <div>
          <span>{text("gameUi.wrong")}</span>
          <strong>{misses}</strong>
        </div>
        <div>
          <span>{text("score.accuracy")}</span>
          <strong>{accuracy}%</strong>
        </div>
      </div>

      <p className="aim-hit-tip color-rush-tip">
        <Zap size={16} />
        {text("gameUi.aimTipStart")} {colorRushRules.comboEveryHits} {text("gameUi.colorTip")} +{colorRushRules.comboBonus}.
      </p>
    </section>
  );
}
