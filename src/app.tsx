import React, {useCallback, useEffect, useRef, useState} from 'react'
import os from 'node:os'
import path from 'node:path'
import {Box, Text, useApp, useInput, useStdout} from 'ink'
import SelectInput from 'ink-select-input'
import Spinner from 'ink-spinner'
import {FramedInput, frameButtonWidth} from './components/framed-input.js'
import {FullScreen} from './components/fullscreen.js'
import {Logo} from './components/logo.js'
import {Panel} from './components/panel.js'
import {ProgressBar} from './components/progress-bar.js'
import {Shortcuts} from './components/shortcuts.js'
import {TextInput} from './components/text-input.js'
import {formatBytes, formatDuration, formatEta, formatSpeed, shortenPath, truncate} from './lib/format.js'
import {addToHistory, loadHistory} from './lib/history.js'
import {detectPlatform, isProbablyUrl, type Platform} from './lib/platforms.js'
import {useMouseClick} from './lib/use-mouse-click.js'
import {theme} from './theme.js'
import {
  buildChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  type DownloadChoice,
  type DownloadProgress,
  type VideoInfo,
} from './lib/ytdlp.js'

const OUT_DIR = path.join(os.homedir(), 'Downloads')
const YOINK_BUTTON = 'yoink'

// explicit blank lines — empty <Box height={1}/> spacers can collapse
const Gap = ({lines = 1}: {lines?: number}) => (
  <Box flexDirection="column">
    {Array.from({length: lines}, (_, i) => (
      <Text key={i}> </Text>
    ))}
  </Box>
)

// fixed-width slots — the centered line must not change width as values tick,
// otherwise the whole layout shifts on every progress update
function partLabel(progress: DownloadProgress): string {
  // explains the bar resetting between files (video, then audio)
  return progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts}  ` : ''
}

function downloadMeta(progress: DownloadProgress): string {
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${partLabel(progress)}${speed.padStart(10)}  ${eta.padEnd(12)}`
}

function indeterminateMeta(progress: DownloadProgress): string {
  const bytes = formatBytes(progress.downloadedBytes)
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  return `${partLabel(progress)}${bytes.padStart(8)}  ${speed.padEnd(10)}`
}

export type Outcome = {filepath?: string}

type Phase =
  | {name: 'input'; warning?: string}
  | {name: 'probing'; status: string}
  | {name: 'picking'}
  | {
      name: 'downloading'
      choice: DownloadChoice
      progress?: DownloadProgress
      processing: boolean
      refreshing?: boolean
    }
  | {name: 'done'; filepath: string}
  | {name: 'error'; message: string}

const HINTS: Record<Phase['name'], Array<[string, string]>> = {
  input: [
    ['↵', 'yoink'],
    ['^c', 'quit'],
  ],
  probing: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  picking: [
    ['↑↓', 'choose'],
    ['↵', 'yoink'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  downloading: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  done: [['^c', 'quit']],
  error: [
    ['↵', 'try again'],
    ['^c', 'quit'],
  ],
}

export function App({
  initialUrl,
  clipboardUrl,
  onOutcome,
}: {
  initialUrl?: string
  clipboardUrl?: string
  onOutcome: (outcome: Outcome) => void
}) {
  const {exit} = useApp()
  const {stdout} = useStdout()
  const [url, setUrl] = useState(initialUrl ?? '')
  const [urlInput, setUrlInput] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const [platform, setPlatform] = useState<Platform>()
  const [info, setInfo] = useState<VideoInfo>()
  const [choices, setChoices] = useState<DownloadChoice[]>([])
  const ytdlpRef = useRef('')
  const infoJsonRef = useRef<string | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>(initialUrl ? {name: 'probing', status: 'warming up…'} : {name: 'input'})

  const columns = stdout?.columns ?? 80
  const boxWidth = Math.min(64, columns - 6)

  const startProbe = useCallback(async (targetUrl: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPlatform(detectPlatform(targetUrl))
    setPhase({name: 'probing', status: 'warming up…'})
    try {
      const ytdlp =
        ytdlpRef.current ||
        (await ensureYtDlp(status => setPhase({name: 'probing', status}), controller.signal))
      ytdlpRef.current = ytdlp
      if (controller.signal.aborted) return
      setPhase({name: 'probing', status: 'fetching video info…'})
      const {info: videoInfo, infoJsonPath} = await probe(ytdlp, targetUrl, controller.signal)
      if (controller.signal.aborted) return
      infoJsonRef.current = infoJsonPath
      setInfo(videoInfo)
      setChoices(buildChoices(videoInfo))
      setPhase({name: 'picking'})
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }, [])

  useEffect(() => {
    if (initialUrl) void startProbe(initialUrl)
  }, [initialUrl, startProbe])

  const resetToInput = useCallback(() => {
    setUrl('')
    setUrlInput('')
    setPlatform(undefined)
    setInfo(undefined)
    setChoices([])
    setPhase({name: 'input'})
  }, [])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    resetToInput()
    setUrlInput(url) // keep the link around so a cancel isn't destructive
  }, [resetToInput, url])

  useInput(
    (_input, key) => {
      if (key.escape && (phase.name === 'picking' || phase.name === 'error' || phase.name === 'done')) resetToInput()
      if (key.escape && (phase.name === 'probing' || phase.name === 'downloading')) cancelRun()
      if (key.return && (phase.name === 'error' || phase.name === 'done')) resetToInput()
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const handleUrlSubmit = (value: string) => {
    const trimmed = value.trim()
    if (!isProbablyUrl(trimmed)) {
      setPhase({name: 'input', warning: 'that doesn’t look like a link — paste a full url'})
      return
    }
    setUrl(trimmed)
    void startProbe(trimmed)
  }

  // Hit-test clicks against the yoink button. Ink has no absolute-position
  // API, so the button's cell rectangle is re-derived from the input-phase
  // layout below — keep both in sync: FullScreen centers a column of
  // logo(3) + gap(1) + tagline(1) + subtitle(1) + gap(1) = 7 rows above the
  // 3-row frame, then warning/clipboard-note?(1) + gap(2) + shortcuts(1)
  // below it.
  const rows = stdout?.rows ?? 24
  const buttonW = frameButtonWidth(YOINK_BUTTON)
  const clipboardOffered = Boolean(clipboardUrl) && urlInput === ''
  const clipboardAccepted = Boolean(clipboardUrl) && urlInput === clipboardUrl
  const noteRow = phase.name === 'input' && (phase.warning || clipboardOffered || clipboardAccepted) ? 1 : 0
  const contentHeight = 7 + 3 + noteRow + 2 + 1
  const frameTop = Math.floor((rows - 1 - contentHeight) / 2) + 7 + 1
  const buttonLeft = Math.floor((columns - (boxWidth + buttonW)) / 2) + boxWidth + 1
  useMouseClick(
    (x, y) => {
      // ±1 cell of slack — centering can round differently than we do
      if (y >= frameTop - 1 && y <= frameTop + 3 && x >= buttonLeft - 1 && x <= buttonLeft + buttonW) {
        handleUrlSubmit(urlInput)
      }
    },
    phase.name === 'input' && Boolean(process.stdin.isTTY),
  )

  // Same idea for the done screen's "↵ yoink another" box: header(7) +
  // yoinked line(1) + filepath(1) + gap(1) = 10 rows above the 3-row box,
  // then gap(2) + shortcuts(1) below it.
  const doneLabel = '↵ yoink another'
  const doneBoxW = doneLabel.length + 8 // paddingX(3)×2 + borders
  const doneBoxTop = Math.floor((rows - 1 - (10 + 3 + 3)) / 2) + 10 + 1
  const doneBoxLeft = Math.floor((columns - doneBoxW) / 2) + 1
  useMouseClick(
    (x, y) => {
      if (y >= doneBoxTop - 1 && y <= doneBoxTop + 3 && x >= doneBoxLeft - 1 && x <= doneBoxLeft + doneBoxW) {
        resetToInput()
      }
    },
    phase.name === 'done' && Boolean(process.stdin.isTTY),
  )

  const handlePick = (item: {value: number}) => {
    const choice = choices[item.value]
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({name: 'downloading', choice, processing: false})
    void (async () => {
      const handlers = {
        onProgress: (progress: DownloadProgress) =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, progress, processing: false} : prev)),
        onProcessing: () =>
          setPhase(prev => (prev.name === 'downloading' ? {...prev, processing: true} : prev)),
      }
      try {
        const ffmpegLocation = await findFfmpeg()
        const base = {ytdlp: ytdlpRef.current, ffmpegLocation, url, choice, outDir: OUT_DIR}
        let filepath: string
        try {
          // reuse the probe's metadata — starts immediately instead of re-extracting
          filepath = await download({...base, infoJsonPath: infoJsonRef.current}, handlers, controller.signal)
        } catch (error) {
          if (controller.signal.aborted) throw error
          // media urls in the cached info can expire — retry with a fresh extraction
          setPhase(prev =>
            prev.name === 'downloading' ? {...prev, progress: undefined, refreshing: true} : prev,
          )
          filepath = await download(base, handlers, controller.signal)
        }
        onOutcome({filepath})
        setHistory(addToHistory(url))
        setPhase({name: 'done', filepath})
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: error instanceof Error ? error.message : String(error)})
      }
    })()
  }

  let hints = HINTS[phase.name]
  if (phase.name === 'input' && history.length > 0) {
    hints = [hints[0]!, ['↑', 'history'], ...hints.slice(1)]
  }

  return (
    <FullScreen>
      <Logo />
      <Gap />
      <Text color={theme.primary}>yoink any video. paste. yoink. done.</Text>
      <Text color={theme.gray}>youtube · x · instagram · threads · tiktok · +1800 more</Text>
      <Gap />

      {phase.name === 'input' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title="Paste a link" width={boxWidth} button={YOINK_BUTTON}>
            <TextInput
              value={urlInput}
              onChange={setUrlInput}
              onSubmit={handleUrlSubmit}
              placeholder="https://youtube.com/watch?v=…"
              width={boxWidth - 6}
              history={history}
              submitOnPaste={isProbablyUrl}
              onTab={() => {
                if (clipboardOffered) setUrlInput(clipboardUrl!)
              }}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray}>✗ {phase.warning}</Text>
          ) : clipboardOffered ? (
            <Text color={theme.gray}>link in your clipboard — ⇥ to paste it</Text>
          ) : clipboardAccepted ? (
            <Text color={theme.gray}>from your clipboard — ↵ to yoink it</Text>
          ) : null}
        </Box>
      )}

      {phase.name === 'probing' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title={platform ? platform.label : 'Paste a link'} width={boxWidth} button={YOINK_BUTTON} buttonDim>
            <Text color={theme.gray}>{url.length > boxWidth - 8 ? `${url.slice(0, boxWidth - 9)}…` : url}</Text>
          </FramedInput>
        </Box>
      )}

      {phase.name === 'picking' && platform && (
        <Box width={Math.min(columns - 4, 78)}>
          <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
            <Text bold color={theme.primary}>
              {info?.title}
            </Text>
            <Gap />
            <Text color={theme.gray}>
              ▸ {platform.label}
              {info?.duration ? ` · ${formatDuration(info.duration)}` : ''}
              {info?.uploader ? ` · ${info.uploader}` : ''}
            </Text>
          </Box>
          <Panel title="Download" width={38}>
            <SelectInput
              items={choices.map((choice, index) => ({
                key: String(index),
                label: `${choice.kind === 'audio' ? '♪ ' : '▶ '}${choice.label}`,
                value: index,
              }))}
              onSelect={handlePick}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Gap />
          <Text color={theme.gray}>
            {info?.title ? `${truncate(info.title, 42)} · ` : ''}
            {phase.choice.label}
          </Text>
          <Gap />
          {/* every branch is exactly three rows — bar, gap, meta — so the layout never jumps */}
          {phase.processing ? (
            <>
              <ProgressBar percent={1} />
              <Gap />
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray}> processing…</Text>
              </Text>
            </>
          ) : phase.progress?.totalBytes ? (
            <>
              <ProgressBar percent={phase.progress.downloadedBytes / phase.progress.totalBytes} />
              <Gap />
              <Text color={theme.gray}>{downloadMeta(phase.progress)}</Text>
            </>
          ) : phase.progress ? (
            <>
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray}> downloading…</Text>
              </Text>
              <Gap />
              <Text color={theme.gray}>{indeterminateMeta(phase.progress)}</Text>
            </>
          ) : (
            <>
              <ProgressBar percent={0} />
              <Gap />
              <Text>
                <Text color={theme.primary}>
                  <Spinner type="dots" />
                </Text>
                <Text color={theme.gray}>
                  {phase.refreshing ? ' link expired — grabbing a fresh one…' : ' starting download…'}
                </Text>
              </Text>
            </>
          )}
        </Box>
      )}

      {phase.name === 'done' && (
        <Box flexDirection="column" alignItems="center">
          <Text>
            <Text bold color={theme.primary}>✓ yoinked! </Text>
            <Text color={theme.primary}>find your file in:</Text>
          </Text>
          <Text color={theme.gray}>{shortenPath(phase.filepath, os.homedir(), 60)}</Text>
          <Gap />
          <Box borderStyle="round" borderColor={theme.gray} paddingX={3}>
            <Text bold color={theme.primary}>{doneLabel}</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'error' && (
        <Box flexDirection="column" alignItems="center" width={Math.min(columns - 6, 72)}>
          <Text bold color={theme.primary}>✗ {phase.message}</Text>
        </Box>
      )}

      {hints.length > 0 ? (
        <>
          <Gap lines={2} />
          <Shortcuts
            items={hints}
            leading={
              phase.name === 'probing' ? (
                <Text>
                  <Text color={theme.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={theme.gray}> {phase.status}</Text>
                </Text>
              ) : undefined
            }
          />
        </>
      ) : null}
    </FullScreen>
  )
}
