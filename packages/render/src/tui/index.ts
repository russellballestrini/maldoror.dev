/**
 * TUI Widget Library
 *
 * Reusable terminal UI widgets for building consistent interfaces.
 * Widgets can render to either ANSI streams or ScreenBuffers.
 */

// Types
export {
  type RGB,
  type Alignment,
  type BorderStyle,
  BORDER_CHARS,
  rgbToCell,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
  ANSI_HIDE_CURSOR,
  ANSI_SHOW_CURSOR,
  ANSI_CLEAR_SCREEN,
  ANSI_ALTERNATE_SCREEN_ON,
  ANSI_ALTERNATE_SCREEN_OFF,
} from './types.js';

// Box widget
export {
  type BoxConfig,
  renderBoxToStream,
  renderBoxToBuffer,
  renderDividerToStream,
  renderDividerToBuffer,
} from './box.js';

// Text widget
export {
  type TextConfig,
  renderTextToStream,
  renderTextToBuffer,
  renderMultilineTextToStream,
  renderMultilineTextToBuffer,
  renderGradientTextToStream,
} from './text.js';

// Spinner widget
export {
  type SpinnerStyle,
  type SpinnerConfig,
  SPINNER_FRAMES,
  renderSpinnerFrameToStream,
  SpinnerController,
  createSpinner,
} from './spinner.js';

// Progress bar widget
export {
  type ProgressBarStyle,
  type ProgressBarConfig,
  type StepIndicatorConfig,
  PROGRESS_CHARS,
  renderProgressBarToStream,
  renderProgressBarToBuffer,
  renderStepIndicatorToStream,
} from './progress-bar.js';

// Logo widget
export {
  MALDOROR_LOGO,
  LOGO_WIDTH,
  LOGO_HEIGHT,
  DEFAULT_LOGO_GRADIENT,
  type LogoConfig,
  renderLogoToStream,
  renderSubtitleToStream,
  renderFullLogoToStream,
  AnimatedLogo,
} from './logo.js';

// Loading step widget
export {
  type LoadingStepStatus,
  type LoadingStepConfig,
  type LoadingStep,
  STATUS_ICONS,
  STATUS_COLORS,
  TEXT_COLORS,
  renderLoadingStepToStream,
  updateLoadingStepIconToStream,
  LoadingStepsController,
} from './loading-step.js';

// Input box widget
export {
  type InputBoxConfig,
  renderInputBoxToStream,
  renderInputBoxToBuffer,
  updateInputValueToStream,
} from './input-box.js';

// Keyboard hint widget
export {
  type KeyHint,
  type KeyboardHintConfig,
  renderKeyboardHintsToStream,
  renderKeyboardHintsToBuffer,
  getKeyboardHintsWidth,
  COMMON_HINTS,
} from './keyboard-hint.js';

// List widget
export {
  type ListStyle,
  type ListConfig,
  type KeyValuePair,
  type KeyValueListConfig,
  renderListToStream,
  renderListToBuffer,
  renderKeyValueListToStream,
  renderKeyValueListToBuffer,
} from './list.js';
