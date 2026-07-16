import React from 'react'
import {Text} from 'ink'
import {theme} from '../theme.js'

export function Shortcuts({items}: {items: Array<[key: string, label: string]>}) {
  return (
    <Text>
      {items.map(([key, label], index) => (
        <Text key={`${key}-${label}`}>
          {index > 0 ? <Text color={theme.gray}>{'  ·  '}</Text> : null}
          <Text color={theme.primary}>{key}</Text>
          <Text color={theme.gray}> {label}</Text>
        </Text>
      ))}
    </Text>
  )
}
