"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

type ButtonsActions = { restart: () => Promise<void> };
type PayPalNamespace = {
  Buttons: (opts: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }, actions: ButtonsActions) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close: () => Promise<void> };
};

const loaders = new Map<string, Promise<PayPalNamespace>>();

/** Loads the PayPal JS SDK once per currency, under its own namespace. */
function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  const ns = `paypal_${currency}`;
  let p = loaders.get(ns);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons`;
      s.dataset.namespace = ns;
      s.onload = () => resolve((window as unknown as Record<string, PayPalNamespace>)[ns]!);
      s.onerror = () => reject(new Error("Could not load PayPal"));
      document.head.appendChild(s);
    });
    loaders.set(ns, p);
  }
  return p;
}

/** A milestone funding capture: the money is now in holding until the client accepts the delivery. */
export type MilestoneCaptureOutcome = { contract_id: string; milestone_id: string; milestone_state: string; payment_status: string; amount: { display: string }; already_captured: boolean };

/**
 * PayPal checkout. createOrder reuses the PayPal order an agent created, or
 * asks the server to start one for the next unfunded milestone of the
 * contract. onApprove calls
 * the capture route: the payer's click in PayPal is the approval.
 */
export function PayPalButtons(props: {
  clientId: string | null;
  currency: string;
  contractId: string;
  paypalOrderId?: string;
  approveUrl?: string;
  onPaid: (o: MilestoneCaptureOutcome) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | undefined>(props.approveUrl);
  const { clientId, currency, contractId, paypalOrderId, onPaid } = props;

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let closed = false;
    let instance: { close: () => Promise<void> } | undefined;
    const el = ref.current;
    loadSdk(clientId, currency)
      .then((paypal) => {
        if (closed) return;
        const buttons = paypal.Buttons({
          createOrder: async () => {
            if (paypalOrderId) return paypalOrderId;
            const res = await api<{ paypal_order_id: string; approve_url: string }>(`/api/contracts/${contractId}/fund`, { method: "POST" });
            setFallbackUrl(res.approve_url);
            return res.paypal_order_id;
          },
          onApprove: async (data, actions) => {
            try {
              onPaid(await api<MilestoneCaptureOutcome>("/api/milestone-checkout/capture", { body: { paypal_order_id: data.orderID } }));
            } catch (err) {
              if (err instanceof ApiError && err.code === "PAYMENT_DECLINED" && err.details?.restart) {
                setMessage(err.message);
                return actions.restart();
              }
              setMessage(err instanceof Error ? err.message : "Payment failed.");
            }
          },
          onCancel: () => setMessage("Payment cancelled. Nothing was charged."),
          onError: () => setMessage("PayPal reported an error. Nothing was charged; please try again."),
        });
        instance = buttons;
        return buttons.render(el);
      })
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Could not load PayPal."));
    return () => {
      closed = true;
      void instance?.close();
    };
  }, [clientId, currency, contractId, paypalOrderId, onPaid]);

  return (
    <div className="space-y-2">
      {clientId ? <div ref={ref} /> : <p className="text-sm text-amber-700">PayPal is not configured (PAYPAL_CLIENT_ID is empty).</p>}
      {fallbackUrl && (
        <a className="text-xs text-blue-700 underline" href={fallbackUrl}>
          Or pay on the PayPal site (redirect)
        </a>
      )}
      {message && <p className="text-sm text-red-700">{message}</p>}
    </div>
  );
}
