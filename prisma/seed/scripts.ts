import type { Lang } from "./catalogue";

/**
 * Buyer-seller conversation scripts. Lines alternate buyer, seller, buyer, ...
 * Every line exists in every language so a message can carry a translation
 * into the other party's language. Placeholders: {product}, {country}
 * (buyer's country in that language), {name} (buyer's first name).
 */

export type Scenario = "question" | "shipping" | "damaged" | "custom" | "thanks";
type Line = Record<Lang, string>;

export const SUBJECTS: Record<Scenario, Line> = {
  question: { en: "Shipping question", de: "Frage zum Versand", fr: "Question sur la livraison", es: "Pregunta sobre el envío", it: "Domanda sulla spedizione", ja: "配送についての質問", hi: "शिपिंग के बारे में सवाल" },
  shipping: { en: "Where is my parcel?", de: "Wo ist mein Paket?", fr: "Où est mon colis ?", es: "¿Dónde está mi paquete?", it: "Dov'è il mio pacco?", ja: "荷物はどこですか?", hi: "मेरा पार्सल कहाँ है?" },
  damaged: { en: "Item arrived damaged", de: "Artikel beschädigt angekommen", fr: "Article arrivé endommagé", es: "El artículo llegó dañado", it: "Articolo arrivato danneggiato", ja: "商品が破損して届きました", hi: "सामान टूटा हुआ पहुँचा" },
  custom: { en: "Custom request", de: "Sonderwunsch", fr: "Demande personnalisée", es: "Pedido personalizado", it: "Richiesta personalizzata", ja: "特別なご依頼", hi: "विशेष अनुरोध" },
  thanks: { en: "Thank you, and a reorder", de: "Danke und eine Nachbestellung", fr: "Merci, et une nouvelle commande", es: "Gracias, y otro pedido", it: "Grazie, e un nuovo ordine", ja: "お礼と追加注文", hi: "धन्यवाद, और एक नया ऑर्डर" },
};

export const SCRIPTS: Record<Scenario, Line[]> = {
  question: [
    {
      en: "Hi! Does the {product} ship to {country}, and roughly how long does it take?",
      de: "Hallo! Wird {product} nach {country} versendet, und wie lange dauert das ungefähr?",
      fr: "Bonjour ! Le produit « {product} » est-il livré en {country}, et en combien de temps environ ?",
      es: "¡Hola! ¿Envían {product} a {country}? ¿Cuánto tarda más o menos?",
      it: "Ciao! Spedite {product} in {country}? Quanto ci vuole più o meno?",
      ja: "こんにちは。「{product}」は{country}へ発送できますか?届くまでどのくらいかかりますか?",
      hi: "नमस्ते! क्या {product} {country} भेजा जाता है, और लगभग कितना समय लगता है?",
    },
    {
      en: "Hello {name}, yes, we ship to {country}. It usually arrives in 6 to 9 working days, with tracking.",
      de: "Hallo {name}, ja, wir versenden nach {country}. Es kommt meist in 6 bis 9 Werktagen an, mit Sendungsverfolgung.",
      fr: "Bonjour {name}, oui, nous livrons en {country}. Comptez en général 6 à 9 jours ouvrés, avec suivi.",
      es: "Hola {name}, sí, enviamos a {country}. Suele llegar en 6 a 9 días hábiles, con seguimiento.",
      it: "Ciao {name}, sì, spediamo in {country}. Di solito arriva in 6-9 giorni lavorativi, con tracciamento.",
      ja: "{name}様、はい、{country}へ発送できます。通常6〜9営業日で届き、追跡番号もお送りします。",
      hi: "नमस्ते {name}, हाँ, हम {country} भेजते हैं। आमतौर पर 6 से 9 कार्यदिवस लगते हैं, ट्रैकिंग के साथ।",
    },
    {
      en: "Perfect, thank you. Is the price shown the final price, including shipping?",
      de: "Perfekt, danke. Ist der angezeigte Preis der Endpreis inklusive Versand?",
      fr: "Parfait, merci. Le prix affiché est-il le prix final, livraison comprise ?",
      es: "Perfecto, gracias. ¿El precio que aparece es el final, con envío incluido?",
      it: "Perfetto, grazie. Il prezzo indicato è quello finale, spedizione inclusa?",
      ja: "ありがとうございます。表示価格は送料込みの最終価格ですか?",
      hi: "बढ़िया, धन्यवाद। क्या दिखाई गई कीमत शिपिंग सहित अंतिम कीमत है?",
    },
    {
      en: "Yes, shipping is included. Any import duty depends on your country and is charged on delivery.",
      de: "Ja, der Versand ist inklusive. Eventuelle Einfuhrabgaben hängen von Ihrem Land ab und werden bei Zustellung erhoben.",
      fr: "Oui, la livraison est incluse. D'éventuels droits d'importation dépendent de votre pays et sont perçus à la livraison.",
      es: "Sí, el envío está incluido. Los posibles aranceles dependen de tu país y se cobran en la entrega.",
      it: "Sì, la spedizione è inclusa. Eventuali dazi dipendono dal tuo paese e si pagano alla consegna.",
      ja: "はい、送料込みです。輸入関税がかかる場合はお住まいの国によって異なり、配達時に請求されます。",
      hi: "हाँ, शिपिंग शामिल है। कोई आयात शुल्क आपके देश पर निर्भर करता है और डिलीवरी पर लिया जाता है।",
    },
  ],
  shipping: [
    {
      en: "My order with the {product} hasn't moved in tracking for four days. Is everything okay?",
      de: "Meine Bestellung mit {product} bewegt sich seit vier Tagen nicht in der Sendungsverfolgung. Ist alles in Ordnung?",
      fr: "Ma commande « {product} » n'a pas bougé dans le suivi depuis quatre jours. Tout va bien ?",
      es: "Mi pedido de {product} no avanza en el seguimiento desde hace cuatro días. ¿Va todo bien?",
      it: "Il mio ordine con {product} è fermo nel tracciamento da quattro giorni. Va tutto bene?",
      ja: "「{product}」の注文の追跡が4日間更新されていません。大丈夫でしょうか?",
      hi: "{product} वाला मेरा ऑर्डर चार दिनों से ट्रैकिंग में आगे नहीं बढ़ा है। क्या सब ठीक है?",
    },
    {
      en: "Sorry for the wait, {name}. The parcel is being held at customs in {country}. This usually clears within 2 to 3 days.",
      de: "Entschuldigen Sie die Wartezeit, {name}. Das Paket liegt beim Zoll in {country}. Das dauert meist 2 bis 3 Tage.",
      fr: "Désolé pour l'attente, {name}. Le colis est retenu à la douane en {country}. Cela se règle en général en 2 à 3 jours.",
      es: "Perdona la espera, {name}. El paquete está retenido en la aduana de {country}. Suele resolverse en 2 o 3 días.",
      it: "Scusa per l'attesa, {name}. Il pacco è fermo alla dogana in {country}. Di solito si sblocca in 2-3 giorni.",
      ja: "{name}様、お待たせして申し訳ありません。荷物は{country}の税関で保留中です。通常2〜3日で通関します。",
      hi: "{name}, इंतज़ार के लिए क्षमा करें। पार्सल {country} में कस्टम्स पर रुका है। यह आमतौर पर 2 से 3 दिन में छूट जाता है।",
    },
    {
      en: "Thanks for checking. I'll keep an eye on it.",
      de: "Danke fürs Nachsehen. Ich behalte es im Blick.",
      fr: "Merci d'avoir vérifié. Je garde un œil dessus.",
      es: "Gracias por revisarlo. Estaré pendiente.",
      it: "Grazie per aver controllato. Lo tengo d'occhio.",
      ja: "確認していただきありがとうございます。様子を見ます。",
      hi: "जाँच करने के लिए धन्यवाद। मैं इस पर नज़र रखूँगी।",
    },
    {
      en: "Good news: customs has released it. It should reach you this week.",
      de: "Gute Nachricht: Der Zoll hat es freigegeben. Es sollte diese Woche bei Ihnen sein.",
      fr: "Bonne nouvelle : la douane l'a libéré. Il devrait vous parvenir cette semaine.",
      es: "Buenas noticias: la aduana lo ha liberado. Debería llegarte esta semana.",
      it: "Buone notizie: la dogana l'ha rilasciato. Dovrebbe arrivarti questa settimana.",
      ja: "朗報です。税関を通過しました。今週中に届く見込みです。",
      hi: "अच्छी ख़बर: कस्टम्स ने इसे छोड़ दिया है। यह इस हफ़्ते आप तक पहुँच जाना चाहिए।",
    },
  ],
  damaged: [
    {
      en: "The {product} arrived with a crack on one side. The box was crushed too.",
      de: "{product} ist mit einem Riss an einer Seite angekommen. Der Karton war auch eingedrückt.",
      fr: "« {product} » est arrivé fêlé sur un côté. Le carton était écrasé aussi.",
      es: "{product} llegó con una grieta en un lado. La caja también venía aplastada.",
      it: "{product} è arrivato con una crepa su un lato. Anche la scatola era schiacciata.",
      ja: "「{product}」の片側にひびが入って届きました。箱もつぶれていました。",
      hi: "{product} एक तरफ़ दरार के साथ पहुँचा। डिब्बा भी दबा हुआ था।",
    },
    {
      en: "I'm very sorry, {name}. I can refund part of the price, or send a replacement. Which would you prefer?",
      de: "Das tut mir sehr leid, {name}. Ich kann einen Teil des Preises erstatten oder Ersatz schicken. Was wäre Ihnen lieber?",
      fr: "Je suis vraiment désolé, {name}. Je peux vous rembourser une partie du prix ou envoyer un remplacement. Que préférez-vous ?",
      es: "Lo siento mucho, {name}. Puedo devolverte parte del precio o enviarte uno nuevo. ¿Qué prefieres?",
      it: "Mi dispiace molto, {name}. Posso rimborsare parte del prezzo o mandarti un sostituto. Cosa preferisci?",
      ja: "{name}様、大変申し訳ありません。一部返金か、交換品の発送のどちらかで対応できます。どちらがよろしいですか?",
      hi: "{name}, मुझे बहुत खेद है। मैं कीमत का कुछ हिस्सा लौटा सकता हूँ, या बदले में नया भेज सकता हूँ। आप क्या पसंद करेंगे?",
    },
    {
      en: "A partial refund is fine. I'd like to keep it.",
      de: "Eine Teilerstattung ist in Ordnung. Ich möchte es behalten.",
      fr: "Un remboursement partiel me convient. Je préfère le garder.",
      es: "Un reembolso parcial está bien. Me gustaría quedármelo.",
      it: "Un rimborso parziale va bene. Vorrei tenerlo.",
      ja: "一部返金で大丈夫です。商品はそのまま使います。",
      hi: "आंशिक रिफ़ंड ठीक है। मैं इसे रखना चाहूँगी।",
    },
    {
      en: "Done. The refund has gone through PayPal and should show in a few days.",
      de: "Erledigt. Die Erstattung ist über PayPal veranlasst und sollte in ein paar Tagen sichtbar sein.",
      fr: "C'est fait. Le remboursement est passé par PayPal et devrait apparaître d'ici quelques jours.",
      es: "Hecho. El reembolso se ha enviado por PayPal y aparecerá en unos días.",
      it: "Fatto. Il rimborso è partito tramite PayPal e dovrebbe comparire tra qualche giorno.",
      ja: "手続きが完了しました。PayPalで返金済みで、数日以内に反映されます。",
      hi: "हो गया। रिफ़ंड PayPal से भेज दिया गया है और कुछ दिनों में दिख जाना चाहिए।",
    },
  ],
  custom: [
    {
      en: "Could you make the {product} in a different colour, or add initials?",
      de: "Könnten Sie {product} in einer anderen Farbe machen oder Initialen hinzufügen?",
      fr: "Pourriez-vous faire « {product} » dans une autre couleur, ou y ajouter des initiales ?",
      es: "¿Podrías hacer {product} en otro color o añadir unas iniciales?",
      it: "Potresti fare {product} in un altro colore o aggiungere delle iniziali?",
      ja: "「{product}」を別の色で作っていただくか、イニシャルを入れていただくことはできますか?",
      hi: "क्या आप {product} किसी दूसरे रंग में बना सकते हैं, या उस पर नाम के अक्षर जोड़ सकते हैं?",
    },
    {
      en: "We can do a custom colour for a small extra charge. Initials aren't possible on this piece, sorry.",
      de: "Eine Sonderfarbe ist gegen einen kleinen Aufpreis möglich. Initialen gehen bei diesem Stück leider nicht.",
      fr: "Une couleur sur mesure est possible avec un petit supplément. Les initiales ne sont pas possibles sur cette pièce, désolé.",
      es: "Podemos hacer un color personalizado con un pequeño recargo. Las iniciales no son posibles en esta pieza, lo siento.",
      it: "Possiamo fare un colore su misura con un piccolo supplemento. Le iniziali non sono possibili su questo pezzo, mi dispiace.",
      ja: "少しの追加料金で色の変更は可能です。申し訳ありませんが、この商品にイニシャルは入れられません。",
      hi: "थोड़े अतिरिक्त शुल्क पर हम अलग रंग बना सकते हैं। इस चीज़ पर अक्षर जोड़ना संभव नहीं है, क्षमा करें।",
    },
    {
      en: "Great, I'll think about the colour and order next week.",
      de: "Super, ich überlege mir die Farbe und bestelle nächste Woche.",
      fr: "Parfait, je réfléchis à la couleur et je commande la semaine prochaine.",
      es: "Genial, pensaré el color y haré el pedido la semana que viene.",
      it: "Perfetto, ci penso sul colore e ordino la prossima settimana.",
      ja: "わかりました。色を考えて来週注文します。",
      hi: "बढ़िया, मैं रंग के बारे में सोचकर अगले हफ़्ते ऑर्डर करूँगी।",
    },
  ],
  thanks: [
    {
      en: "The {product} arrived today and it's beautiful. Thank you!",
      de: "{product} ist heute angekommen und wunderschön. Vielen Dank!",
      fr: "« {product} » est arrivé aujourd'hui, il est magnifique. Merci !",
      es: "{product} ha llegado hoy y es precioso. ¡Gracias!",
      it: "{product} è arrivato oggi ed è bellissimo. Grazie!",
      ja: "「{product}」が今日届きました。とても素敵です。ありがとうございます!",
      hi: "{product} आज पहुँचा और यह बहुत सुंदर है। धन्यवाद!",
    },
    {
      en: "Thank you, {name}! I'm so glad you like it.",
      de: "Danke, {name}! Es freut mich sehr, dass es Ihnen gefällt.",
      fr: "Merci, {name} ! Je suis ravi qu'il vous plaise.",
      es: "¡Gracias, {name}! Me alegra mucho que te guste.",
      it: "Grazie, {name}! Sono felice che ti piaccia.",
      ja: "{name}様、ありがとうございます!気に入っていただけて嬉しいです。",
      hi: "धन्यवाद, {name}! मुझे बहुत ख़ुशी है कि आपको यह पसंद आया।",
    },
    {
      en: "I'd like to order two more as gifts. Can you ship them together?",
      de: "Ich möchte noch zwei als Geschenk bestellen. Können Sie sie zusammen verschicken?",
      fr: "J'aimerais en commander deux autres pour offrir. Pouvez-vous les expédier ensemble ?",
      es: "Quiero pedir dos más para regalar. ¿Puedes enviarlos juntos?",
      it: "Vorrei ordinarne altri due da regalare. Puoi spedirli insieme?",
      ja: "贈り物用にあと2つ注文したいです。一緒に発送できますか?",
      hi: "मैं उपहार के लिए दो और ऑर्डर करना चाहती हूँ। क्या आप उन्हें एक साथ भेज सकते हैं?",
    },
    {
      en: "Of course. Add both to one cart and they'll go out in a single parcel.",
      de: "Natürlich. Legen Sie beide in einen Warenkorb, dann gehen sie in einem Paket raus.",
      fr: "Bien sûr. Ajoutez-les au même panier et ils partiront dans un seul colis.",
      es: "Claro. Añade los dos al mismo carrito y saldrán en un solo paquete.",
      it: "Certo. Aggiungili allo stesso carrello e partiranno in un unico pacco.",
      ja: "もちろんです。同じカートに入れていただければ、一つの荷物で発送します。",
      hi: "ज़रूर। दोनों को एक ही कार्ट में डालें, वे एक ही पार्सल में भेजे जाएँगे।",
    },
  ],
};

export function fill(template: string, vars: { product: string; country: string; name: string }): string {
  return template.replaceAll("{product}", vars.product).replaceAll("{country}", vars.country).replaceAll("{name}", vars.name);
}
