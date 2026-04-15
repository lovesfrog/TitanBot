import loggingButtonsHandler from '../../handlers/loggingButtons.js';

export default [
  {
    name: 'logging_toggle',
    execute: loggingButtonsHandler.execute,
  },
  {
    name: 'logging_refresh_status',
    execute: loggingButtonsHandler.execute,
  },
  {
    name: 'log_dash_toggle',
    execute: loggingButtonsHandler.execute,
  },
  {
    name: 'log_dash_refresh',
    execute: loggingButtonsHandler.execute,
  },
];