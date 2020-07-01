'use strict';

/*
 * CLI: Command: RUN
 */

const path = require('path');
const { runningTemplate } = require('../utils');
const { ServerlessSDK } = require('@serverless/platform-client-china');
const utils = require('./utils');
const runAll = require('./runAll');
const chalk = require('chalk');
const generateNotificationsPayload = require('../notifications/generate-payload');
const requestNotification = require('../notifications/request');
const printNotification = require('../notifications/print-notification');

module.exports = async (config, cli, command) => {
  if (runningTemplate(process.cwd())) {
    return runAll(config, cli, command);
  }

  // Start CLI persistance status
  cli.start('Initializing', { timer: true });

  await utils.login();

  // Load YAML
  let instanceDir = process.cwd();
  if (config.target) {
    instanceDir = path.join(instanceDir, config.target);
  }
  const instanceYaml = await utils.loadInstanceConfig(instanceDir);

  // Presentation
  const meta = `Action: "${command}" - Stage: "${instanceYaml.stage}" - App: "${instanceYaml.app}" - Instance: "${instanceYaml.name}"`;
  if (!config.debug) {
    cli.logLogo();
    cli.log(meta, 'grey');
  } else {
    cli.log(meta);
  }

  cli.status('Initializing', instanceYaml.name);

  // Load Instance Credentials
  const instanceCredentials = await utils.loadInstanceCredentials(instanceYaml.stage);

  // initialize SDK
  const sdk = new ServerlessSDK({
    context: {
      orgName: instanceYaml.org,
    },
  });

  // Prepare Command Inputs
  utils.setInputsForCommand(instanceYaml, command, config);

  // Prepare Options
  const options = {};
  options.debug = config.debug;
  options.dev = config.dev;

  let deferredNotificationsData;
  if (command === 'deploy') {
    deferredNotificationsData = requestNotification(
      Object.assign(generateNotificationsPayload(instanceYaml), { command: 'deploy' })
    );

    // Warn about dev agent
    if (options.dev) {
      cli.log();
      cli.log(
        '"--dev" option detected.  Dev Agent will be added to your code.  Do not deploy this in your production stage.',
        'grey'
      );
    }

    // run deploy
    cli.status('Initializing', null, 'white');
    options.statusReceiver = (statusMsg) => {
      if (statusMsg) {
        cli.status(statusMsg, null, 'white');
      } else {
        cli.status('Deploying', null, 'white');
      }
    };
    const instance = await sdk.deploy(instanceYaml, instanceCredentials, options);
    const vendorMessage = instance.outputs.vendorMessage;
    delete instance.outputs.vendorMessage;
    cli.log();
    cli.logOutputs(instance.outputs);
    cli.log();
    cli.log(`${chalk.grey(utils.getInstanceDashboardUrl(instanceYaml))}`);
    if (vendorMessage) {
      cli.log();
      cli.log(`${chalk.green(vendorMessage)}`);
    }
  } else if (command === 'remove') {
    // run remove
    cli.status('Removing', null, 'white');
    await sdk.remove(instanceYaml, instanceCredentials, options);
  } else if (command === 'login') {
    // we have do login upside, so if command is login, do nothing here
    // no op
  } else {
    // run a custom method synchronously to receive outputs directly
    options.sync = true;

    // run a custom method
    cli.status('Running', null, 'white');
    const instance = await sdk.run(command, instanceYaml, instanceCredentials, options);

    cli.log();
    cli.logOutputs(instance.outputs);
  }
  cli.close('success', 'Success');

  if (deferredNotificationsData) printNotification(cli, await deferredNotificationsData);
  return null;
};
