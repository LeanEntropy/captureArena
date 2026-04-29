export class NameEntry {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private onPlay: ((name: string) => void) | null = null;

  constructor() {
    this.container = document.getElementById("name-entry")!;
    this.input = document.getElementById("name-input") as HTMLInputElement;
    this.button = document.getElementById("play-btn") as HTMLButtonElement;

    this.button.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });

    this.input.focus();
  }

  setOnPlay(callback: (name: string) => void): void {
    this.onPlay = callback;
  }

  private submit(): void {
    const name = this.input.value.trim() || `Player${Math.floor(Math.random() * 999)}`;
    this.container.classList.add("hidden");
    if (this.onPlay) this.onPlay(name);
  }

  show(): void {
    this.container.classList.remove("hidden");
    this.input.focus();
  }

  hide(): void {
    this.container.classList.add("hidden");
  }
}
