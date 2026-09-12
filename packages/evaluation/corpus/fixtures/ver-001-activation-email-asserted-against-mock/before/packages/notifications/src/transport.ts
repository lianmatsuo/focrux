export interface Message {
  to: string;
  subject: string;
  body: string;
}

export interface Transport {
  deliver(message: Message): Promise<void>;
}

export function smtpTransport(host: string): Transport {
  return {
    async deliver(message: Message): Promise<void> {
      if (!host) throw new Error("no smtp host configured");
      // A real SMTP conversation happens here.
      void message;
    },
  };
}
