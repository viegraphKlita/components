/*
 * Serverless Components: Utilities
 */

const path = require('path')
const fs = require('fs')
const args = require('minimist')(process.argv.slice(2))
const { utils: platformUtils } = require('@serverless/platform-client-china')
const { loadInstanceConfig, resolveInputVariables } = require('../utils')

const updateEnvFile = (envs) => {
  // write env file
  const envFilePath = path.join(process.cwd(), '.env')

  let envFileContent = ''
  if (fs.existsSync(envFilePath)) {
    envFileContent = fs.readFileSync(envFilePath, 'utf8')
  }

  // update process.env and existing key in .env file
  for (const [key, value] of Object.entries(envs)) {
    process.env[key] = value
    const regex = new RegExp(`${key}=[^\n]+(\n|$)`)
    envFileContent = envFileContent.replace(regex, '')
  }

  fs.writeFileSync(
    envFilePath,
    `${envFileContent}\n${Object.entries(envs).reduce(
      (a, [key, value]) => (a += `${key}=${value}\n`),
      ''
    )}`
  )
}

const getDefaultOrgName = async () => {
  return await platformUtils.getOrgId()
}

/**
 * Reads a serverless instance config file in a given directory path
 * @param {*} directoryPath
 */
const loadTencentInstanceConfig = async (directoryPath) => {
  const instanceFile = loadInstanceConfig(directoryPath)

  if (!instanceFile) {
    throw new Error(`serverless config file was not found`)
  }

  if (!instanceFile.name) {
    throw new Error(`Missing "name" property in serverless.yml`)
  }

  if (!instanceFile.component) {
    throw new Error(`Missing "component" property in serverless.yml`)
  }

  // if stage flag provided, overwrite
  if (args.stage) {
    instanceFile.stage = args.stage
  }

  // if org flag provided, overwrite
  if (args.org) {
    instanceFile.org = args.org
  }

  if (!instanceFile.org) {
    instanceFile.org = await getDefaultOrgName()
  }

  if (!instanceFile.org) {
    throw new Error(`Missing "org" property in serverless.yml`)
  }

  // if app flag provided, overwrite
  if (args.app) {
    instanceFile.app = args.app
  }

  if (!instanceFile.app) {
    instanceFile.app = instanceFile.name
  }

  if (instanceFile.inputs) {
    // load credentials to process .env files before resolving env variables
    await loadInstanceCredentials(instanceFile.stage)
    instanceFile.inputs = resolveInputVariables(instanceFile.inputs)
    if (instanceFile.inputs.src) {
      if (typeof instanceFile.inputs.src === 'string') {
        instanceFile.inputs.src = path.resolve(directoryPath, instanceFile.inputs.src)
      } else if (typeof instanceFile.inputs.src === 'object') {
        if (instanceFile.inputs.src.src) {
          instanceFile.inputs.src.src = path.resolve(directoryPath, instanceFile.inputs.src.src)
        }
        if (instanceFile.inputs.src.dist) {
          instanceFile.inputs.src.dist = path.resolve(directoryPath, instanceFile.inputs.src.dist)
        }
      }
    }
  }

  return instanceFile
}

/**
 * Gets the logged in user's token id, or access key if its in env
 */
const login = async () => {
  const [reLoggedIn, credentials] = await platformUtils.loginWithTencent()
  if (reLoggedIn) {
    const { secret_id, secret_key, appid, token } = credentials
    updateEnvFile({
      TENCENT_APP_ID: appid,
      TENCENT_SECRET_ID: secret_id,
      TENCENT_SECRET_KEY: secret_key,
      TENCENT_TOKEN: token
    })
  }
}

/**
 * Load credentials from a ".env" or ".env.[stage]" file
 * @param {*} stage
 */
const loadInstanceCredentials = (stage) => {
  // Load env vars TODO
  const envVars = {}

  // Known Provider Environment Variables and their SDK configuration properties
  const providers = {}

  // Tencent
  providers.tencent = {}
  providers.tencent.TENCENT_APP_ID = 'AppId'
  providers.tencent.TENCENT_SECRET_ID = 'SecretId'
  providers.tencent.TENCENT_SECRET_KEY = 'SecretKey'
  providers.tencent.TENCENT_TOKEN = 'Token'

  const credentials = {}

  for (const provider in providers) {
    const providerEnvVars = providers[provider]
    for (const providerEnvVar in providerEnvVars) {
      if (!credentials[provider]) {
        credentials[provider] = {}
      }
      // Proper environment variables override what's in the .env file
      if (process.env.hasOwnProperty(providerEnvVar)) {
        credentials[provider][providerEnvVars[providerEnvVar]] = process.env[providerEnvVar]
      } else if (envVars.hasOwnProperty(providerEnvVar)) {
        credentials[provider][providerEnvVars[providerEnvVar]] = envVars[providerEnvVar]
      }
      continue
    }
  }

  return credentials
}

const getTemplate = async (root) => {
  const directories = fs
    .readdirSync(root)
    .filter((f) => fs.statSync(path.join(root, f)).isDirectory())

  const template = {
    name: path.basename(process.cwd()),
    org: null,
    app: null, // all components must explicitly set app property
    stage: null
  }

  let componentDirectoryFound = false
  for (const directory of directories) {
    const directoryPath = path.join(root, directory)

    const instanceYml = loadInstanceConfig(directoryPath)

    if (instanceYml) {
      componentDirectoryFound = true
      const instanceYaml = await loadTencentInstanceConfig(directoryPath)

      if (template.org !== null && template.org !== instanceYaml.org) {
        throw new Error('Attempting to deploy multiple instances to multiple orgs')
      }

      if (template.app !== null && template.app !== instanceYaml.app) {
        throw new Error('Attempting to deploy multiple instances to multiple apps')
      }

      if (template.stage !== null && template.stage !== instanceYaml.stage) {
        throw new Error('Attempting to deploy multiple instances to multiple stages')
      }

      template.org = instanceYaml.org // eslint-disable-line
      template.app = instanceYaml.app // eslint-disable-line
      template.stage = instanceYaml.stage // eslint-disable-line

      // update paths in inputs
      if (instanceYaml.inputs.src) {
        if (typeof instanceYaml.inputs.src === 'string') {
          instanceYaml.inputs.src = path.join(directoryPath, instanceYaml.inputs.src)
        } else if (typeof instanceYaml.inputs.src === 'object') {
          if (instanceYaml.inputs.src.src) {
            instanceYaml.inputs.src.src = path.join(directoryPath, instanceYaml.inputs.src.src)
          }

          if (instanceYaml.inputs.src.dist) {
            instanceYaml.inputs.src.dist = path.join(directoryPath, instanceYaml.inputs.src.dist)
          }
        }
      }

      template[instanceYml.name] = instanceYaml
    }
  }

  return componentDirectoryFound ? template : null
}

module.exports = {
  loadInstanceConfig: loadTencentInstanceConfig,
  loadInstanceCredentials,
  login,
  getDefaultOrgName,
  getTemplate
}
