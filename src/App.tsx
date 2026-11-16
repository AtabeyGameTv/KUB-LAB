import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import {
  applyMove,
  applyMoves,
  COLOR_META,
  createEmptyDraftFacelets,
  createSolvedFacelets,
  generateScramble,
  invertMove,
  isFaceComplete,
  isSolvedFacelets,
  validateDraftFacelets,
  WIZARD_PALETTE_ORDER,
  WIZARD_STEPS,
} from './cube/cubeMath';
import { Cube3DViewport, type Cube3DHandle } from './cube/Cube3DViewport';
import { solveFacelets, warmUpSolver } from './cube/kociembaSolver';
import type { ColorId, DraftFacelets, Facelets, MoveName } from './cube/types';

type AppMode = 'input' | 'solve';
type PlaybackSpeed = 0.5 | 1 | 2;

export default function App() {
  const cubeRef = useRef<Cube3DHandle | null>(null);

  const [mode, setMode] = useState<AppMode>('input');
  const [faceStep, setFaceStep] = useState(0); // 0..5 -> F, R, B, L, U, D
  const [draftFacelets, setDraftFacelets] = useState<DraftFacelets>(() =>
    createEmptyDraftFacelets()
  );
  const [selectedColor, setSelectedColor] = useState<ColorId>('G');
  const [focusedCell, setFocusedCell] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Solve mode state
  const [solveFaceletsState, setSolveFaceletsState] = useState<Facelets>(() =>
    createSolvedFacelets()
  );
  const [solutionBase, setSolutionBase] = useState<Facelets | null>(null);
  const [solution, setSolution] = useState<MoveName[]>([]);
  const [currentMoveStep, setCurrentMoveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const speedRef = useRef(speed);
  speedRef.current = speed;

  const currentWizard = WIZARD_STEPS[faceStep];

  // Warm up Kociemba tables asynchronously after first paint
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        warmUpSolver();
      } catch {
        // Lazy init on first solve
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  // Smoothly rotate 3D cube to the active face when step changes in Input Mode
  useEffect(() => {
    if (mode !== 'input') return;
    cubeRef.current?.focusFace(WIZARD_STEPS[faceStep].face);
    const offset = WIZARD_STEPS[faceStep].offset;
    let firstEmpty = -1;
    for (let i = 0; i < 9; i++) {
      if (draftFacelets[offset + i] === null) {
        firstEmpty = i;
        break;
      }
    }
    setFocusedCell(firstEmpty !== -1 ? firstEmpty : 0);
  }, [faceStep, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const colorCounts = useMemo(() => {
    const counts: Record<ColorId, number> = { W: 0, R: 0, G: 0, Y: 0, O: 0, B: 0 };
    for (const c of draftFacelets) {
      if (c !== null) counts[c]++;
    }
    return counts;
  }, [draftFacelets]);

  const currentFaceComplete = useMemo(
    () => isFaceComplete(draftFacelets, currentWizard.offset),
    [draftFacelets, currentWizard.offset]
  );

  // Calibrated slower, smooth turn durations so every move is easy to follow visually
  const getStepDurationMs = (spd: PlaybackSpeed) => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return 16;
    if (spd === 2) return 280;
    if (spd === 0.5) return 850;
    return 520;
  };

  const handlePaintCell = useCallback(
    (localIdx: number) => {
      setErrorMsg(null);
      setInfoMsg(null);

      const offset = currentWizard.offset;
      const globalIdx = offset + localIdx;

      setDraftFacelets((prev) => {
        const next = prev.slice();
        next[globalIdx] = selectedColor;
        cubeRef.current?.setFaceletsImmediate(next);

        let nextEmpty = -1;
        for (let step = 1; step <= 9; step++) {
          const candidate = (localIdx + step) % 9;
          if (next[offset + candidate] === null) {
            nextEmpty = candidate;
            break;
          }
        }
        setFocusedCell(nextEmpty !== -1 ? nextEmpty : localIdx);
        return next;
      });
    },
    [currentWizard.offset, selectedColor]
  );

  const handleClearCurrentFace = useCallback(() => {
    setErrorMsg(null);
    setInfoMsg(null);
    const offset = currentWizard.offset;
    setDraftFacelets((prev) => {
      const next = prev.slice();
      for (let i = 0; i < 9; i++) {
        next[offset + i] = null;
      }
      cubeRef.current?.setFaceletsImmediate(next);
      return next;
    });
    setFocusedCell(0);
  }, [currentWizard.offset]);

  const handleResetAll = useCallback(() => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsPlaying(false);
    cubeRef.current?.clearQueue();
    const empty = createEmptyDraftFacelets();
    setDraftFacelets(empty);
    setFaceStep(0);
    setSelectedColor('G');
    setFocusedCell(0);
    setMode('input');
    setSolution([]);
    setSolutionBase(null);
    setCurrentMoveStep(0);
    cubeRef.current?.setFaceletsImmediate(empty);
    cubeRef.current?.focusFace(WIZARD_STEPS[0].face);
  }, []);

  const handleSolveAttempt = useCallback(
    (targetDraft?: DraftFacelets) => {
      setErrorMsg(null);
      setInfoMsg(null);
      const source = targetDraft ?? draftFacelets;
      const validation = validateDraftFacelets(source);
      if (!validation.valid) {
        setErrorMsg(validation.error || 'Kub konfiqurasiyası düzgün deyil.');
        return;
      }

      const validFacelets = source as Facelets;
      if (isSolvedFacelets(validFacelets)) {
        setInfoMsg('Kub artıq yığılmış vəziyyətdədir.');
        return;
      }

      try {
        const res = solveFacelets(validFacelets);
        setSolveFaceletsState(validFacelets.slice());
        setSolutionBase(validFacelets.slice());
        setSolution(res.moves);
        setCurrentMoveStep(0);
        setIsPlaying(false);
        setMode('solve');
        cubeRef.current?.setFaceletsImmediate(validFacelets);
        cubeRef.current?.focusSolveView();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Həll tapılmadı.');
      }
    },
    [draftFacelets]
  );

  const handleScramble = useCallback(() => {
    if (busy || isPlayingRef.current) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const scrambleMoves = generateScramble(20);
    const scrambled = applyMoves(createSolvedFacelets(), scrambleMoves);

    if (mode === 'solve') {
      cubeRef.current?.clearQueue();
      setIsPlaying(false);
      setDraftFacelets(scrambled);
      handleSolveAttempt(scrambled);
      return;
    }

    setDraftFacelets(scrambled);
    setFaceStep(5);
    cubeRef.current?.setFaceletsImmediate(scrambled);
    cubeRef.current?.focusFace(WIZARD_STEPS[5].face);
    setInfoMsg('20 gedişlə qarışdırıldı. "Həll Et" düyməsini sıxın.');
  }, [busy, handleSolveAttempt, mode]);

  const handleBackToInput = useCallback(() => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsPlaying(false);
    cubeRef.current?.clearQueue();
    setMode('input');
    cubeRef.current?.setFaceletsImmediate(draftFacelets);
    cubeRef.current?.focusFace(WIZARD_STEPS[faceStep].face);
  }, [draftFacelets, faceStep]);

  const handleNextMove = useCallback(() => {
    if (busy || isPlayingRef.current) return;
    if (currentMoveStep >= solution.length) return;
    const move = solution[currentMoveStep];
    cubeRef.current?.enqueueTurn({
      move,
      durationMs: getStepDurationMs(speedRef.current),
      onComplete: () => {
        setSolveFaceletsState((prev) => applyMove(prev, move));
        setCurrentMoveStep((s) => s + 1);
      },
    });
  }, [busy, currentMoveStep, solution]);

  const handlePrevMove = useCallback(() => {
    if (busy || isPlayingRef.current) return;
    if (currentMoveStep <= 0) return;
    const inv = invertMove(solution[currentMoveStep - 1]);
    cubeRef.current?.enqueueTurn({
      move: inv,
      durationMs: getStepDurationMs(speedRef.current),
      onComplete: () => {
        setSolveFaceletsState((prev) => applyMove(prev, inv));
        setCurrentMoveStep((s) => s - 1);
      },
    });
  }, [busy, currentMoveStep, solution]);

  const handleJumpToMove = useCallback(
    (stepIdx: number) => {
      if (!solutionBase || solution.length === 0) return;
      setIsPlaying(false);
      cubeRef.current?.clearQueue();
      const clamped = Math.max(0, Math.min(stepIdx, solution.length));
      const next = applyMoves(solutionBase, solution.slice(0, clamped));
      setSolveFaceletsState(next);
      setCurrentMoveStep(clamped);
      cubeRef.current?.setFaceletsImmediate(next);
    },
    [solution, solutionBase]
  );

  // Auto-play progression with brief natural settle pause between moves
  useEffect(() => {
    if (mode !== 'solve' || !isPlaying) return;
    if (currentMoveStep >= solution.length) {
      setIsPlaying(false);
      return;
    }
    if (busy) return;

    const pauseMs = currentMoveStep === 0 ? 40 : 110;
    const timer = window.setTimeout(() => {
      if (!isPlayingRef.current) return;
      const move = solution[currentMoveStep];
      cubeRef.current?.enqueueTurn({
        move,
        durationMs: getStepDurationMs(speedRef.current),
        onComplete: () => {
          setSolveFaceletsState((prev) => applyMove(prev, move));
          setCurrentMoveStep((s) => s + 1);
        },
      });
    }, pauseMs);

    return () => window.clearTimeout(timer);
  }, [busy, currentMoveStep, isPlaying, mode, solution]);

  const handleTogglePlay = useCallback(() => {
    if (solution.length === 0) return;
    if (isPlayingRef.current) {
      setIsPlaying(false);
      return;
    }
    if (currentMoveStep >= solution.length) {
      handleJumpToMove(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying(true);
  }, [currentMoveStep, handleJumpToMove, solution.length]);

  // Keyboard shortcuts for desktop convenience
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (mode === 'solve') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNextMove();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrevMove();
        } else if (e.key === ' ') {
          e.preventDefault();
          handleTogglePlay();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNextMove, handlePrevMove, handleTogglePlay, mode]);

  const solvedDone = mode === 'solve' && solution.length > 0 && currentMoveStep >= solution.length;
  const isCubeSolvedNow = isSolvedFacelets(solveFaceletsState);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#121212] text-slate-100">
      {/* Desktop Top Navigation Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-white/8 bg-[#161616] px-5 lg:px-7">
        {/* Zone 1: Wordmark / Back to Input */}
        <div className="flex items-center gap-3 shrink-0">
          {mode === 'solve' && (
            <button
              type="button"
              onClick={handleBackToInput}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Rəng Daxiletməyə Qayıt
            </button>
          )}
          <span className="font-display text-base lg:text-lg font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            Rubik Kubu Həlledicisi
          </span>
        </div>

        {/* Zone 2: Active Stage Indicator */}
        <div className="hidden md:flex items-center gap-3 text-xs font-medium text-slate-300">
          {mode === 'input' ? (
            <span>
              Üz {faceStep + 1} / 6: <strong className="text-slate-100">{currentWizard.titleAz}</strong>
            </span>
          ) : (
            <span>
              Həll Rejimi
              <span className="mx-2 text-slate-600">·</span>
              <span className="font-mono tabular-nums text-emerald-400">
                Addım {currentMoveStep} / {solution.length}
              </span>
            </span>
          )}
        </div>

        {/* Zone 3: Quick Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={busy || isPlaying}
            onClick={handleScramble}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <Shuffle className="h-3.5 w-3.5 text-emerald-400" />
            Təsadüfi Qarışdır
          </button>

          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-300" />
            Sıfırla
          </button>
        </div>
      </header>

      {/* Main Desktop Workspace */}
      <main className="relative flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Left / Center: Expansive 3D Cube Viewport */}
        <section className="relative h-[40vh] shrink-0 lg:h-full lg:flex-1 lg:min-h-0 overflow-hidden">
          <Cube3DViewport
            ref={cubeRef}
            initialFacelets={mode === 'solve' ? solveFaceletsState : draftFacelets}
            onBusyChange={setBusy}
          />

          {/* Top-left subtle camera & status line */}
          <div className="pointer-events-none absolute top-4 left-5 right-5 z-10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-slate-200 font-medium">
                {mode === 'input'
                  ? `${currentWizard.titleAz} görünüşü`
                  : isCubeSolvedNow && solvedDone
                    ? 'Kub tam yığıldı'
                    : 'Addım-addım 3D Həll'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="hidden sm:inline">
                Siçanla fırladın · Scroll ilə yaxınlaşdırın
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                mode === 'solve'
                  ? cubeRef.current?.focusSolveView()
                  : cubeRef.current?.focusFace(currentWizard.face)
              }
              className="pointer-events-auto inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#181818]/90 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-white/25 hover:text-white whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
              Baxışı Sıfırla
            </button>
          </div>

          {/* Solve Mode: Bottom Docked Step-by-Step Player */}
          {mode === 'solve' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
              <div className="pointer-events-auto w-full max-w-[880px] rounded-2xl border border-white/10 bg-[#171817]/94 p-4 shadow-[0_24px_64px_rgba(0,0,0,0.75)]">
                {/* Header row: Notation + Speed */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="font-semibold text-slate-100">Həll Ardıcıllığı</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-emerald-400">
                      Addım {currentMoveStep} / {solution.length}
                    </span>
                    <span aria-hidden="true" className="hidden sm:inline text-slate-600">·</span>
                    <span className="hidden sm:inline text-slate-400">
                      Klaviatura: ← / → və Space
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Sürət:</span>
                    <div className="flex items-center rounded-lg border border-white/10 bg-[#121212] p-0.5">
                      {([0.5, 1, 2] as PlaybackSpeed[]).map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => setSpeed(sp)}
                          className={`min-h-[32px] rounded-md px-2.5 font-mono text-xs tabular-nums transition-colors ${
                            speed === sp
                              ? 'bg-emerald-500/20 font-semibold text-emerald-300'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {sp}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Clickable Standard Notation Strip */}
                <div className="mt-3 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1.5">
                  {solution.map((mv, idx) => {
                    const isDone = idx < currentMoveStep;
                    const isActive = idx === currentMoveStep;
                    return (
                      <button
                        key={`${idx}-${mv}`}
                        type="button"
                        onClick={() => handleJumpToMove(idx + 1)}
                        className={`min-h-[38px] min-w-[42px] shrink-0 rounded-lg border px-2.5 font-mono text-xs font-semibold tabular-nums transition-all ${
                          isActive
                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50'
                            : isDone
                              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400/80'
                              : 'border-white/10 bg-[#202221] text-slate-200 hover:border-white/25 hover:bg-[#282B29]'
                        }`}
                      >
                        {mv}
                      </button>
                    );
                  })}
                </div>

                {/* Playback Controls */}
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    disabled={currentMoveStep <= 0 || busy || isPlaying}
                    onClick={handlePrevMove}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#222423] px-4 text-xs sm:text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap"
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    Əvvəlki Addım
                  </button>

                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs sm:text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 whitespace-nowrap"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4 shrink-0" />
                        Dayandır
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 shrink-0" />
                        {solvedDone ? 'Yenidən Oynat' : 'Avtomatik Oynat'}
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={currentMoveStep >= solution.length || busy || isPlaying}
                    onClick={handleNextMove}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#222423] px-4 text-xs sm:text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap"
                  >
                    Növbəti Addım
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Side Panel: Step-by-Step Face Input (Desktop Split) */}
        {mode === 'input' && (
          <aside className="flex min-h-0 flex-1 w-full flex-col border-t lg:flex-none lg:h-full lg:w-[440px] xl:w-[470px] lg:border-t-0 lg:border-l border-white/8 bg-[#161616]">
            {/* Scrollable Body */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 lg:p-5">
              {/* 6-step Progress Segments */}
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-100">
                    Üz {faceStep + 1} / 6: {currentWizard.titleAz}
                  </span>
                  <span className="text-slate-400">Bütün 9 xananı rəngləyin</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {WIZARD_STEPS.map((step, idx) => {
                    const complete = isFaceComplete(draftFacelets, step.offset);
                    const isCurrent = idx === faceStep;
                    return (
                      <button
                        key={step.face}
                        type="button"
                        onClick={() => {
                          setErrorMsg(null);
                          setInfoMsg(null);
                          setFaceStep(idx);
                        }}
                        title={step.titleAz}
                        aria-label={step.titleAz}
                        className="py-1 focus-visible:outline-none"
                      >
                        <div
                          className={`h-2 w-full rounded-md transition-all duration-200 ${
                            isCurrent
                              ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                              : complete
                                ? 'bg-emerald-500/55 hover:bg-emerald-400/80'
                                : 'bg-white/12 hover:bg-white/25'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Face 3x3 Rounded-Square Grid */}
              <div className="flex flex-col items-center rounded-2xl border border-white/8 bg-[#121212] p-3.5 lg:p-4">
                <div className="mb-2.5 flex w-full max-w-[236px] items-center justify-between text-xs text-slate-400">
                  <span>Xanalara klikləyib rəngləyin</span>
                  <button
                    type="button"
                    onClick={handleClearCurrentFace}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-100"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    Üzü təmizlə
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {Array.from({ length: 9 }, (_, i) => {
                    const colorId = draftFacelets[currentWizard.offset + i];
                    const isFocused = i === focusedCell;
                    const meta = colorId ? COLOR_META[colorId] : null;

                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handlePaintCell(i)}
                        aria-label={`${currentWizard.titleAz} xana ${i + 1}${meta ? `: ${meta.nameAz}` : ': boş'}`}
                        className={`relative flex h-16 w-16 xl:h-[74px] xl:w-[74px] cursor-pointer items-center justify-center rounded-xl border border-white/12 transition-all duration-150 hover:scale-[1.03] active:scale-95 ${
                          isFocused
                            ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#121212]'
                            : ''
                        }`}
                        style={{
                          backgroundColor: meta ? meta.hex : '#2C3034',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Color Palette (Rounded-Square Tiles — NO circular dots) */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">Rəng Seçin</span>
                  <span className="font-mono tabular-nums text-slate-400">Hər rəng: 9 ədəd</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {WIZARD_PALETTE_ORDER.map((cid) => {
                    const meta = COLOR_META[cid];
                    const isSelected = selectedColor === cid;
                    const count = colorCounts[cid];
                    const shortName = meta.nameAz.split(' ')[0];

                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => setSelectedColor(cid)}
                        aria-pressed={isSelected}
                        className={`group relative flex min-h-[44px] flex-col justify-between rounded-xl border px-2.5 py-2 text-left transition-all duration-150 ${
                          isSelected
                            ? 'border-emerald-400 bg-emerald-500/12 ring-1 ring-emerald-400/50'
                            : 'border-white/10 bg-[#1D1F1E] hover:border-white/25 hover:bg-[#232625]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1.5">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-black/35 shadow-sm"
                              style={{ backgroundColor: meta.hex }}
                            >
                              {isSelected && (
                                <Check
                                  className={`h-3 w-3 stroke-[3] ${
                                    meta.textDark ? 'text-slate-900' : 'text-white'
                                  }`}
                                />
                              )}
                            </span>
                            <span className="truncate text-xs font-medium text-slate-100">
                              {shortName}
                            </span>
                          </span>
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              count === 9
                                ? 'text-emerald-400'
                                : count > 9
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                            }`}
                          >
                            {count}/9
                          </span>
                        </div>

                        {/* Active bottom glow bar */}
                        <span
                          className={`mt-1 block h-0.5 w-full rounded-sm transition-all duration-150 ${
                            isSelected
                              ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                              : 'bg-transparent'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Validation / Info Message */}
              {(errorMsg || infoMsg) && (
                <div
                  role="alert"
                  className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                    errorMsg
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      errorMsg ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  />
                  <span className="leading-relaxed">{errorMsg || infoMsg}</span>
                </div>
              )}
            </div>

            {/* Pinned Bottom Navigation: < Əvvəlki & Növbəti > / Həll Et */}
            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-white/8 bg-[#161616] px-4 py-3 lg:px-5">
              <button
                type="button"
                disabled={faceStep === 0}
                onClick={() => {
                  setErrorMsg(null);
                  setInfoMsg(null);
                  setFaceStep((s) => Math.max(0, s - 1));
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-[#202221] px-4 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap"
              >
                <ChevronLeft className="h-4 w-4" />
                Əvvəlki
              </button>

              {faceStep < 5 ? (
                <button
                  type="button"
                  disabled={!currentFaceComplete}
                  onClick={() => {
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setFaceStep((s) => Math.min(5, s + 1));
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500 whitespace-nowrap"
                >
                  Növbəti
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!currentFaceComplete}
                  onClick={() => handleSolveAttempt()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.28)] transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none whitespace-nowrap"
                >
                  <Sparkles className="h-4 w-4" />
                  Həll Et
                </button>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
