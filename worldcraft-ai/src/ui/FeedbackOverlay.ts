/**
 * FeedbackOverlay — loading spinner and error toasts.
 * Plain HTML/CSS; works in both desktop and XR DOM Overlay modes.
 */

export class FeedbackOverlay {
  private spinner: HTMLElement;
  private toastContainer: HTMLElement;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.spinner = this.createSpinner();
    this.toastContainer = this.createToastContainer();
    document.body.appendChild(this.spinner);
    document.body.appendChild(this.toastContainer);
  }

  showLoading(): void {
    this.spinner.style.display = 'flex';
  }

  hideLoading(): void {
    this.spinner.style.display = 'none';
  }

  showError(message: string): void {
    this.toastContainer.textContent = message;
    this.toastContainer.style.display = 'block';
    if (this.dismissTimer != null) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => this.hideError(), 4000);
  }

  hideError(): void {
    this.toastContainer.style.display = 'none';
  }

  private createSpinner(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'wc-spinner';
    Object.assign(el.style, {
      display:         'none',
      position:        'fixed',
      top:             '50%',
      left:            '50%',
      transform:       'translate(-50%, -50%)',
      width:           '48px',
      height:          '48px',
      border:          '5px solid rgba(255,255,255,0.3)',
      borderTopColor:  '#fff',
      borderRadius:    '50%',
      animation:       'wc-spin 0.8s linear infinite',
      zIndex:          '9999',
      pointerEvents:   'none',
    });
    this.injectSpinnerCSS();
    return el;
  }

  private injectSpinnerCSS(): void {
    if (document.getElementById('wc-spinner-css')) return;
    const style = document.createElement('style');
    style.id = 'wc-spinner-css';
    style.textContent = `@keyframes wc-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  private createToastContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'wc-toast';
    Object.assign(el.style, {
      display:       'none',
      position:      'fixed',
      top:           '80px',          // below the input widget
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(180,40,40,0.92)',
      color:         '#fff',
      padding:       '10px 20px',
      borderRadius:  '8px',
      fontSize:      '13px',
      zIndex:        '9998',
      pointerEvents: 'none',
      maxWidth:      '80vw',
      textAlign:     'center',
    });
    return el;
  }
}
