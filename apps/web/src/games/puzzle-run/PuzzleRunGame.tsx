import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, CheckCircle2, Play, Route } from "lucide-react";
import { calculatePlayPoints, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type PuzzleRunGameProps = {
  language: Language;
  onFinish: (result: GameResult) => void;
};

type PuzzleStep = {
  id: string;
  prompt: number[];
  answer: number;
  choices: number[];
};

const durationSeconds = 10;

function createStep(index: number): PuzzleStep {
  const start = 1 + Math.floor(Math.random() * 5);
  const increment = 1 + Math.floor(Math.random() * 4);
  const prompt = [start, start + increment, start + increment * 2];
  const answer = start + increment * 3;
  const choices = [answer, answer + increment, Math.max(1, answer - increment), answer + increment + 2].sort(
    () => Math.random() - 0.5
  );

  return {
    id: `puzzle-step-${index}-${start}-${increment}`,
    prompt,
    answer,
    choices
  };
}

export function PuzzleRunGame({ language, onFinish }: PuzzleRunGameProps) {
  const text = (key: string) => getText(language, key);
  const [step, setStep] = useState<PuzzleStep>(() => createStep(0));
  const [stepNumber, setStepNumber] = useState(1);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
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
      gameId: "puzzle-run",
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
    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      setTimeLeft(Math.max(0, Math.ceil((durationSeconds * 1000 - elapsedMs) / 1000)));

      if (elapsedMs >= durationSeconds * 1000) {
        window.clearInterval(timer);
        finishGame();
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [finishGame, finished, playing]);

  const startGame = () => {
    setStep(createStep(1));
    setStepNumber(1);
    setTimeLeft(durationSeconds);
    setScore(0);
    setHits(0);
    setMisses(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    resultRef.current = { score: 0, hits: 0, misses: 0, accuracy: 0, maxCombo: 0 };
    setPlaying(true);
  };

  const chooseAnswer = (choice: number) => {
    if (!playing || finished) return;

    if (choice === step.answer) {
      setHits((value) => value + 1);
      setCombo((value) => {
        const nextCombo = value + 1;
        setMaxCombo((current) => Math.max(current, nextCombo));
        setScore((current) => current + 24 + nextCombo * 3);
        return nextCombo;
      });
    } else {
      setMisses((value) => value + 1);
      setCombo(0);
      setScore((value) => Math.max(0, value - 10));
    }

    setStepNumber((value) => {
      const nextStepNumber = value + 1;
      setStep(createStep(nextStepNumber));
      return nextStepNumber;
    });
  };

  return (
    <section className="aim-hit-game puzzle-run-game">
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

      <div className="aim-hit-arena puzzle-run-arena">
        <span className="arena-grid" />
        <div className="puzzle-track">
          {Array.from({ length: 5 }, (_, index) => (
            <span className={index < Math.min(5, stepNumber) ? "active" : ""} key={index} />
          ))}
        </div>
        <div className="puzzle-card">
          <span>{text("gameUi.step")} {stepNumber}</span>
          <strong>{step.prompt.join("  /  ")}  /  ?</strong>
        </div>
        <div className="puzzle-choice-grid">
          {step.choices.map((choice) => (
            <button key={`${step.id}-${choice}`} type="button" onClick={() => chooseAnswer(choice)}>
              {choice}
            </button>
          ))}
        </div>
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="puzzle-run-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <Route size={34} />
              </div>
              <span>Puzzle Run</span>
              <h2 id="puzzle-run-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.puzzleIntro")}</p>
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

      <p className="aim-hit-tip memory-tip">
        <CheckCircle2 size={16} />
        {text("gameUi.puzzleTip")}
      </p>
    </section>
  );
}
