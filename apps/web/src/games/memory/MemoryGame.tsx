import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, CheckCircle2, Play, Sparkles } from "lucide-react";
import { calculatePlayPoints, memoryRules, type GameResult } from "@playpoint/shared";
import { getText, type Language } from "../../i18n";

type MemoryCard = {
  id: string;
  value: number;
};

type MemoryGameProps = {
  language: Language;
  onFinish: (result: GameResult) => void;
};

function createDeck(): MemoryCard[] {
  return Array.from({ length: memoryRules.cards }, (_, index) => ({
    id: `memory-card-${index + 1}`,
    value: index + 1
  })).sort(() => Math.random() - 0.5);
}

export function MemoryGame({ language, onFinish }: MemoryGameProps) {
  const text = (key: string) => getText(language, key);
  const [deck, setDeck] = useState<MemoryCard[]>(() => createDeck());
  const [timeLeft, setTimeLeft] = useState<number>(memoryRules.durationSeconds);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [nextValue, setNextValue] = useState(1);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  const [previewing, setPreviewing] = useState(false);
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
    resultRef.current = { score, hits, misses, accuracy, maxCombo: hits };
  }, [accuracy, hits, misses, score]);

  const finishGame = useCallback(() => {
    if (finished) return;
    setFinished(true);
    const result = resultRef.current;
    onFinish({
      gameId: "memory",
      score: result.score,
      playPoints: calculatePlayPoints(result.score),
      durationSeconds: memoryRules.durationSeconds,
      hits: result.hits,
      misses: result.misses,
      accuracy: result.accuracy,
      maxCombo: result.maxCombo
    });
  }, [finished, onFinish]);

  useEffect(() => {
    if (!playing || finished) return;

    const startedAt = Date.now();
    const durationMs = memoryRules.durationSeconds * 1000;

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

  useEffect(() => {
    if (!previewing) return;
    const previewTimer = window.setTimeout(() => setPreviewing(false), memoryRules.previewSeconds * 1000);
    return () => window.clearTimeout(previewTimer);
  }, [previewing]);

  const startGame = () => {
    setDeck(createDeck());
    setTimeLeft(memoryRules.durationSeconds);
    setScore(0);
    setHits(0);
    setMisses(0);
    setNextValue(1);
    setRevealedIds(new Set());
    setFinished(false);
    setPreviewing(true);
    resultRef.current = {
      score: 0,
      hits: 0,
      misses: 0,
      accuracy: 0,
      maxCombo: 0
    };
    setPlaying(true);
  };

  const chooseCard = (card: MemoryCard) => {
    if (!playing || previewing || finished || revealedIds.has(card.id)) return;

    if (card.value === nextValue) {
      const nextRevealed = new Set(revealedIds);
      nextRevealed.add(card.id);
      setRevealedIds(nextRevealed);
      setHits((value) => value + 1);
      setScore((value) => value + memoryRules.hitScore);

      if (nextValue === memoryRules.cards) {
        setScore((value) => value + memoryRules.completionBonus);
        window.setTimeout(finishGame, 180);
      } else {
        setNextValue((value) => value + 1);
      }
      return;
    }

    setMisses((value) => value + 1);
    setScore((value) => Math.max(0, value - memoryRules.missPenalty));
  };

  return (
    <section className="aim-hit-game memory-game">
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
          <span>{text("gameUi.next")}</span>
          <strong>{nextValue}</strong>
        </div>
      </div>

      <div className="aim-hit-arena memory-arena" aria-label="Memory play area">
        <span className="arena-grid" />
        <div className="memory-grid">
          {deck.map((card) => {
            const visible = previewing || revealedIds.has(card.id);
            return (
              <button
                className={visible ? "memory-card revealed" : "memory-card"}
                key={card.id}
                type="button"
                onClick={() => chooseCard(card)}
                aria-label={visible ? `Card ${card.value}` : "Hidden memory card"}
              >
                <span>{visible ? card.value : "?"}</span>
              </button>
            );
          })}
        </div>
        {!playing ? (
          <div className="game-start-overlay" role="dialog" aria-modal="true" aria-labelledby="memory-start-title">
            <div className="game-start-modal">
              <div className="game-start-icon">
                <Brain size={34} />
              </div>
              <span>Memory</span>
              <h2 id="memory-start-title">{text("gameUi.start")}</h2>
              <p>{text("gameUi.memoryIntro")}</p>
              <button className="primary-action" type="button" onClick={startGame}>
                <Play size={18} />
                {text("gameUi.start")}
              </button>
            </div>
          </div>
        ) : null}
        {playing && previewing ? (
          <div className="memory-preview-banner">
            <Sparkles size={16} />
            {text("gameUi.memoryPreview")}
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
        {text("gameUi.memoryTip")} +{memoryRules.completionBonus}.
      </p>
    </section>
  );
}
