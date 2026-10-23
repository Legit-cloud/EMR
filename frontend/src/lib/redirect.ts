/** Send the browser to another address (a payment page). Its own function so tests can replace it. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
