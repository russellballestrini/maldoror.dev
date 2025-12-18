import type { Duplex } from 'stream';

const ESC = '\x1b';

interface OnlinePlayer {
  username: string;
}

/**
 * Boot screen that shows loading progress during connection
 */
export class BootScreen {
  private stream: Duplex;
  private cols: number;
  private currentStep: number = 0;
  private spinnerFrame: number = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(stream: Duplex, cols: number, _rows: number) {
    this.stream = stream;
    this.cols = cols;
  }

  /**
   * Show the initial boot screen
   */
  show(): void {
    // Enter alternate screen, hide cursor, clear
    this.stream.write(`${ESC}[?1049h${ESC}[?25l${ESC}[2J`);
    this.renderLogo();
    this.renderProgressArea();
  }

  private renderLogo(): void {
    const color = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
    const reset = `${ESC}[0m`;

    const logo = [
      '███╗   ███╗ █████╗ ██╗     ██████╗  ██████╗ ██████╗  ██████╗ ██████╗ ',
      '████╗ ████║██╔══██╗██║     ██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗██╔══██╗',
      '██╔████╔██║███████║██║     ██║  ██║██║   ██║██████╔╝██║   ██║██████╔╝',
      '██║╚██╔╝██║██╔══██║██║     ██║  ██║██║   ██║██╔══██╗██║   ██║██╔══██╗',
      '██║ ╚═╝ ██║██║  ██║███████╗██████╔╝╚██████╔╝██║  ██║╚██████╔╝██║  ██║',
      '╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝',
    ];

    const logoWidth = logo[0]!.length;
    const startX = Math.max(1, Math.floor((this.cols - logoWidth) / 2));
    const startY = 3;

    // Broody color gradient - deep crimson to dark burgundy
    const colors = [
      [120, 40, 60],   // Deep crimson
      [100, 35, 55],   // Dark wine
      [85, 30, 50],    // Burgundy
      [70, 25, 45],    // Dark plum
      [60, 20, 40],    // Deep maroon
      [50, 15, 35],    // Almost black red
    ];

    for (let i = 0; i < logo.length; i++) {
      const [r, g, b] = colors[i]!;
      this.stream.write(`${ESC}[${startY + i};${startX}H${color(r!, g!, b!)}${logo[i]}${reset}`);
    }

    // Subtitle in muted gray
    const subtitle = 'T E R M I N A L   M M O';
    const subX = Math.floor((this.cols - subtitle.length) / 2);
    this.stream.write(`${ESC}[${startY + 8};${subX}H${color(80, 70, 75)}${subtitle}${reset}`);
  }

  private renderProgressArea(): void {
    const boxWidth = 50;
    const boxHeight = 8;
    const startX = Math.floor((this.cols - boxWidth) / 2);
    const startY = 14;

    // Dim broody border color
    const dim = `${ESC}[38;2;50;40;45m`;
    const reset = `${ESC}[0m`;

    // Box
    this.stream.write(`${ESC}[${startY};${startX}H${dim}┌${'─'.repeat(boxWidth - 2)}┐${reset}`);
    for (let i = 1; i < boxHeight - 1; i++) {
      this.stream.write(`${ESC}[${startY + i};${startX}H${dim}│${' '.repeat(boxWidth - 2)}│${reset}`);
    }
    this.stream.write(`${ESC}[${startY + boxHeight - 1};${startX}H${dim}└${'─'.repeat(boxWidth - 2)}┘${reset}`);
  }

  /**
   * Update loading step with progress message
   */
  updateStep(message: string, status: 'loading' | 'done' | 'error' = 'loading'): void {
    this.currentStep++;
    const y = 15 + this.currentStep;
    const x = Math.floor((this.cols - 46) / 2) + 2;

    // Broody status colors
    const statusIcon = status === 'done' ? `${ESC}[38;2;100;140;100m✓${ESC}[0m`      // Muted green
                     : status === 'error' ? `${ESC}[38;2;140;60;60m✗${ESC}[0m`       // Dark red
                     : `${ESC}[38;2;140;100;80m◦${ESC}[0m`;                          // Amber brown

    const textColor = status === 'done' ? `${ESC}[38;2;90;85;88m`                    // Dim gray
                    : status === 'error' ? `${ESC}[38;2;140;60;60m`                  // Dark red
                    : `${ESC}[38;2;130;120;125m`;                                    // Light gray

    const text = message.padEnd(40);
    this.stream.write(`${ESC}[${y};${x}H  ${statusIcon} ${textColor}${text}${ESC}[0m`);
  }

  /**
   * Mark the previous step as done
   */
  markPreviousDone(): void {
    if (this.currentStep > 0) {
      const y = 15 + this.currentStep;
      const x = Math.floor((this.cols - 46) / 2) + 2;
      // Muted green checkmark
      this.stream.write(`${ESC}[${y};${x}H  ${ESC}[38;2;100;140;100m✓${ESC}[0m`);
    }
  }

  /**
   * Render the honourable mentions footer with online players
   */
  renderHonourableMentions(players: OnlinePlayer[]): void {
    const startY = 24;
    const color = (r: number, g: number, b: number) => `${ESC}[38;2;${r};${g};${b}m`;
    const reset = `${ESC}[0m`;

    // Header
    const header = '─── Honourable Mentions ───';
    const headerX = Math.floor((this.cols - header.length) / 2);
    this.stream.write(`${ESC}[${startY};${headerX}H${color(70, 55, 60)}${header}${reset}`);

    if (players.length === 0) {
      const empty = 'No wanderers currently in the abyss';
      const emptyX = Math.floor((this.cols - empty.length) / 2);
      this.stream.write(`${ESC}[${startY + 2};${emptyX}H${color(60, 50, 55)}${empty}${reset}`);
    } else {
      // Show online players
      const names = players.map(p => p.username).join('  ·  ');
      const truncated = names.length > this.cols - 10 ? names.slice(0, this.cols - 13) + '...' : names;
      const namesX = Math.floor((this.cols - truncated.length) / 2);
      this.stream.write(`${ESC}[${startY + 2};${namesX}H${color(100, 80, 90)}${truncated}${reset}`);
    }
  }

  /**
   * Start the spinner animation for current step
   */
  startSpinner(): void {
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % spinnerChars.length;
      const y = 15 + this.currentStep;
      const x = Math.floor((this.cols - 46) / 2) + 4;
      // Amber brown spinner
      this.stream.write(`${ESC}[${y};${x}H${ESC}[38;2;140;100;80m${spinnerChars[this.spinnerFrame]}${ESC}[0m`);
    }, 80);
  }

  /**
   * Stop the spinner
   */
  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  /**
   * Hide the boot screen and transition to game
   */
  hide(): void {
    this.stopSpinner();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopSpinner();
  }
}
