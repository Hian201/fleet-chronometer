/** 將事件導向的立即通知固定到同一個 browser notification ID，供 recovery 安全覆寫。 */
export function createEventNotificationId(eventId: number, purpose: string): string {
    return `kc-event-${eventId}-${purpose}`;
}
