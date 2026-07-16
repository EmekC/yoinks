import React from 'react'
import {Box, Text} from 'ink'
import {theme} from '../theme.js'

const ART = [
  '▓ ▓ █▀█ ▀█▀ █▀▄█ █ █ █▀▀',
  '▀█▀ █ ▓  ▓  █  ▓ ▓▀▄ ▀▀▓',
  ' ▀  ▀▀▀ ▀▀▀ ▀  ▀ ▀ ▀ ▀▀▀',
]

export function Logo() {
  return (
    <Box flexDirection="column">
      {ART.map((line, row) => (
        <Text key={row} color={theme.primary}>
          {line}
        </Text>
      ))}
    </Box>
  )
}
