import React, {type ReactNode} from 'react'
import {Box, Text} from 'ink'
import {theme} from '../theme.js'

/**
 * A single-line input frame with the title sitting on the top border,
 * like `╭─ Paste a link ────╮`. Drawn by hand because ink borders
 * don't support embedded titles.
 */
export function FramedInput({title, width, children}: {title: string; width: number; children: ReactNode}) {
  const inner = width - 2
  const tail = Math.max(0, inner - title.length - 3)
  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text color={theme.gray}>{'╭─ '}</Text>
        <Text color={theme.primary}>{title}</Text>
        <Text color={theme.gray}>{` ${'─'.repeat(tail)}╮`}</Text>
      </Text>
      <Box width={width} height={1} overflow="hidden">
        <Text color={theme.gray}>│ </Text>
        <Text color={theme.primary}>❯ </Text>
        <Box flexGrow={1} height={1} overflow="hidden">
          {children}
        </Box>
        <Text color={theme.gray}> │</Text>
      </Box>
      <Text color={theme.gray}>{`╰${'─'.repeat(inner)}╯`}</Text>
    </Box>
  )
}
