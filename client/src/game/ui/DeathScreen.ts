export class DeathScreen {
  private container: HTMLElement;
  private message: HTMLElement;
  private timer: HTMLElement;

  constructor() {
    this.container = document.getElementById("death-screen")!;
    this.message = document.getElementById("death-message")!;
    this.timer = document.getElementById("death-timer")!;
  }

  show(killerName?: string): void {
    this.message.textContent = killerName
      ? `Killed by ${killerName}`
      : "You died!";
    this.container.classList.add("visible");
  }

  updateTimer(secondsLeft: number): void {
    this.timer.textContent = `Respawning in ${Math.ceil(secondsLeft)}...`;
  }

  hide(): void {
    this.container.classList.remove("visible");
  }
}
