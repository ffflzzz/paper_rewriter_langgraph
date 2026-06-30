import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../lib/theme.js'
import { PROVIDERS, saveConfig, type RewriterConfig } from '../lib/config.js'

interface Props {
  onComplete: (config: RewriterConfig) => void
}

type Step = 'provider' | 'apikey' | 'model' | 'confirm'

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('provider')
  const [providerIdx, setProviderIdx] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [modelIdx, setModelIdx] = useState(0)
  const [baseUrl, setBaseUrl] = useState('')
  const [customUrl, setCustomUrl] = useState('')

  const providerKeys = Object.keys(PROVIDERS)
  const currentProvider = PROVIDERS[providerKeys[providerIdx]]
  const models = currentProvider.models

  useInput((input, key) => {
    if (step === 'provider') {
      if (key.upArrow) setProviderIdx(i => Math.max(0, i - 1))
      if (key.downArrow) setProviderIdx(i => Math.min(providerKeys.length - 1, i + 1))
      if (key.return) {
        if (providerKeys[providerIdx] === 'custom') {
          setStep('apikey')
          setBaseUrl('')
        } else {
          setBaseUrl(currentProvider.baseUrl)
          setStep('apikey')
        }
      }
      return
    }

    if (step === 'apikey') {
      if (key.return) {
        if (apiKey.length > 0) {
          if (providerKeys[providerIdx] === 'custom') {
            setStep('model')
          } else if (models.length === 1) {
            // Only one model, skip selection
            const config: RewriterConfig = {
              provider: providerKeys[providerIdx],
              baseUrl: baseUrl,
              apiKey: apiKey,
              model: models[0],
            }
            saveConfig(config)
            onComplete(config)
          } else {
            setStep('model')
          }
        }
        return
      }
      if (key.backspace || key.delete) {
        setApiKey(prev => prev.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setApiKey(prev => prev + input)
      }
      return
    }

    if (step === 'model') {
      if (key.upArrow) setModelIdx(i => Math.max(0, i - 1))
      if (key.downArrow) setModelIdx(i => Math.min(models.length - 1, i + 1))
      if (key.return) {
        const config: RewriterConfig = {
          provider: providerKeys[providerIdx],
          baseUrl: baseUrl,
          apiKey: apiKey,
          model: models[modelIdx],
        }
        saveConfig(config)
        onComplete(config)
      }
      return
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.green} bold>📝 Paper Rewriter — Setup</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.dimGreen}>{'═'.repeat(50)}</Text>
      </Box>

      {/* Step: Provider */}
      {step === 'provider' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.green}>Select model provider:</Text>
          </Box>
          {providerKeys.map((key, idx) => (
            <Box key={key} paddingLeft={2}>
              <Text color={idx === providerIdx ? theme.green : theme.dimGreen}>
                {idx === providerIdx ? '▸ ' : '  '}
                {PROVIDERS[key].name}
                {key === 'mimo' ? ' (default)' : ''}
              </Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={theme.dimGreen}>↑↓ to select, Enter to confirm</Text>
          </Box>
        </Box>
      )}

      {/* Step: API Key */}
      {step === 'apikey' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.green}>Provider: {currentProvider.name}</Text>
          </Box>
          {providerKeys[providerIdx] === 'custom' && (
            <Box marginBottom={1}>
              <Text color={theme.green}>Base URL: </Text>
              <Text color={theme.white}>{customUrl || '...'}</Text>
            </Box>
          )}
          <Box marginBottom={1}>
            <Text color={theme.green}>Enter API key: </Text>
            <Text color={theme.white}>{apiKey.replace(/./g, '•')}</Text>
            <Text color={theme.dimGreen}>▌</Text>
          </Box>
          <Box>
            <Text color={theme.dimGreen}>Type your API key, then press Enter</Text>
          </Box>
        </Box>
      )}

      {/* Step: Model */}
      {step === 'model' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.green}>Select model:</Text>
          </Box>
          {models.map((model, idx) => (
            <Box key={model} paddingLeft={2}>
              <Text color={idx === modelIdx ? theme.green : theme.dimGreen}>
                {idx === modelIdx ? '▸ ' : '  '}{model}
              </Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={theme.dimGreen}>↑↓ to select, Enter to confirm</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
