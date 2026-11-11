import type { Lang } from "./people";

/**
 * Project thread scripts and brief texts. Thread lines alternate client,
 * freelancer, client, ... Every line exists in every language so a message
 * carries a translation into the other party's language. Placeholders:
 * {service} (service title), {client} and {freelancer} (first names).
 */

export type Scenario = "question" | "kickoff" | "delivery" | "revision" | "thanks";
type Line = Record<Lang, string>;

export const SUBJECTS: Record<Scenario, Line> = {
  question: { en: "Question before ordering", de: "Frage vor der Bestellung", fr: "Question avant de commander", es: "Pregunta antes de contratar", it: "Domanda prima di ordinare", ja: "依頼前の質問", hi: "ऑर्डर से पहले एक सवाल" },
  kickoff: { en: "Project kickoff", de: "Projektstart", fr: "Lancement du projet", es: "Inicio del proyecto", it: "Avvio del progetto", ja: "プロジェクト開始", hi: "प्रोजेक्ट की शुरुआत" },
  delivery: { en: "First delivery", de: "Erste Lieferung", fr: "Première livraison", es: "Primera entrega", it: "Prima consegna", ja: "初回納品", hi: "पहली डिलीवरी" },
  revision: { en: "Changes to the draft", de: "Änderungen am Entwurf", fr: "Modifications de la maquette", es: "Cambios al borrador", it: "Modifiche alla bozza", ja: "ドラフトの修正", hi: "ड्राफ़्ट में बदलाव" },
  thanks: { en: "Thank you, and what's next", de: "Danke, und wie es weitergeht", fr: "Merci, et la suite", es: "Gracias, y lo que sigue", it: "Grazie, e i prossimi passi", ja: "お礼と今後について", hi: "धन्यवाद, और आगे क्या" },
};

export const SCRIPTS: Record<Scenario, Line[]> = {
  question: [
    {
      en: "Hi {freelancer}, before I order {service}: can you start next week, and can we talk once by video?",
      de: "Hallo {freelancer}, bevor ich {service} bestelle: Können Sie nächste Woche anfangen, und können wir einmal per Video sprechen?",
      fr: "Bonjour {freelancer}, avant de commander « {service} » : pouvez-vous commencer la semaine prochaine, et pourrions-nous faire un appel vidéo ?",
      es: "Hola {freelancer}, antes de contratar {service}: ¿puedes empezar la próxima semana y podemos hablar una vez por videollamada?",
      it: "Ciao {freelancer}, prima di ordinare {service}: puoi iniziare la settimana prossima e possiamo sentirci una volta in video?",
      ja: "{freelancer}さん、「{service}」を依頼する前に質問です。来週から始められますか?一度ビデオ通話で話せますか?",
      hi: "नमस्ते {freelancer}, {service} ऑर्डर करने से पहले: क्या आप अगले हफ़्ते शुरू कर सकते हैं, और क्या हम एक बार वीडियो पर बात कर सकते हैं?",
    },
    {
      en: "Hi {client}, yes, I can start on Monday. A 20-minute call works well; send me two times that suit you.",
      de: "Hallo {client}, ja, ich kann am Montag anfangen. Ein 20-minütiges Gespräch passt gut; schicken Sie mir zwei Termine, die Ihnen passen.",
      fr: "Bonjour {client}, oui, je peux commencer lundi. Un appel de 20 minutes me convient ; envoyez-moi deux créneaux.",
      es: "Hola {client}, sí, puedo empezar el lunes. Una llamada de 20 minutos está bien; mándame dos horarios que te convengan.",
      it: "Ciao {client}, sì, posso iniziare lunedì. Una chiamata di 20 minuti va benissimo; mandami due orari che ti vanno bene.",
      ja: "{client}さん、はい、月曜日から始められます。20分ほどの通話で大丈夫です。ご都合の良い時間を2つ教えてください。",
      hi: "नमस्ते {client}, हाँ, मैं सोमवार से शुरू कर सकता/सकती हूँ। 20 मिनट की कॉल ठीक रहेगी; अपनी सुविधा के दो समय भेज दीजिए।",
    },
    {
      en: "Great, Tuesday at 10:00 or Wednesday at 15:00, my time. I'll place the order after the call.",
      de: "Super, Dienstag um 10:00 oder Mittwoch um 15:00 Uhr meiner Zeit. Ich bestelle nach dem Gespräch.",
      fr: "Parfait, mardi à 10 h ou mercredi à 15 h, heure locale. Je passerai commande après l'appel.",
      es: "Perfecto, el martes a las 10:00 o el miércoles a las 15:00, hora mía. Haré el pedido después de la llamada.",
      it: "Perfetto, martedì alle 10:00 o mercoledì alle 15:00, ora mia. Ordino dopo la chiamata.",
      ja: "ありがとうございます。こちらの時間で火曜10時か水曜15時でお願いします。通話の後に依頼します。",
      hi: "बढ़िया, मेरे समय से मंगलवार सुबह 10 बजे या बुधवार दोपहर 3 बजे। कॉल के बाद मैं ऑर्डर कर दूँगा/दूँगी।",
    },
  ],
  kickoff: [
    {
      en: "Milestone 1 is funded. I've attached our current materials; the deadline for the first draft is flexible.",
      de: "Meilenstein 1 ist bezahlt. Ich habe unsere aktuellen Unterlagen angehängt; die Frist für den ersten Entwurf ist flexibel.",
      fr: "Le jalon 1 est financé. J'ai joint nos documents actuels ; le délai pour la première version est souple.",
      es: "El hito 1 ya está financiado. Adjunté nuestros materiales actuales; la fecha del primer borrador es flexible.",
      it: "La milestone 1 è finanziata. Ho allegato i nostri materiali attuali; la scadenza per la prima bozza è flessibile.",
      ja: "マイルストーン1の支払いを済ませました。現在の資料を添付します。初稿の締め切りは調整できます。",
      hi: "माइलस्टोन 1 का भुगतान हो गया है। मैंने हमारी मौजूदा सामग्री संलग्न कर दी है; पहले ड्राफ़्ट की समय-सीमा लचीली है।",
    },
    {
      en: "Thanks {client}, I have everything I need. You'll get the first draft in the project thread before the due date.",
      de: "Danke {client}, ich habe alles, was ich brauche. Den ersten Entwurf bekommen Sie vor dem Fälligkeitsdatum hier im Projekt.",
      fr: "Merci {client}, j'ai tout ce qu'il me faut. Vous recevrez la première version ici avant l'échéance.",
      es: "Gracias {client}, tengo todo lo necesario. Recibirás el primer borrador aquí antes de la fecha límite.",
      it: "Grazie {client}, ho tutto quello che mi serve. Riceverai la prima bozza qui prima della scadenza.",
      ja: "{client}さん、ありがとうございます。必要な資料はそろっています。初稿は期日までにこのスレッドでお送りします。",
      hi: "धन्यवाद {client}, मेरे पास सब कुछ है। पहला ड्राफ़्ट आपको नियत तारीख से पहले इसी थ्रेड में मिल जाएगा।",
    },
  ],
  delivery: [
    {
      en: "Hi {client}, the first delivery is attached. Please check it and click Accept delivery, or tell me what to change.",
      de: "Hallo {client}, die erste Lieferung ist angehängt. Bitte prüfen Sie sie und klicken Sie auf „Lieferung annehmen“, oder sagen Sie mir, was ich ändern soll.",
      fr: "Bonjour {client}, la première livraison est jointe. Vérifiez-la et cliquez sur « Accepter la livraison », ou dites-moi quoi modifier.",
      es: "Hola {client}, adjunto la primera entrega. Revísala y haz clic en «Aceptar entrega», o dime qué cambiar.",
      it: "Ciao {client}, in allegato la prima consegna. Controllala e clicca su «Accetta consegna», oppure dimmi cosa cambiare.",
      ja: "{client}さん、初回納品物を添付しました。ご確認のうえ「納品を承認」を押すか、修正点を教えてください。",
      hi: "नमस्ते {client}, पहली डिलीवरी संलग्न है। कृपया देखें और “डिलीवरी स्वीकार करें” पर क्लिक करें, या बताएँ कि क्या बदलना है।",
    },
    {
      en: "Looks good! I'll show it to the team today and get back to you tomorrow.",
      de: "Sieht gut aus! Ich zeige es heute dem Team und melde mich morgen.",
      fr: "C'est très bien ! Je le montre à l'équipe aujourd'hui et je reviens vers vous demain.",
      es: "¡Se ve muy bien! Hoy se lo enseño al equipo y te respondo mañana.",
      it: "Molto bello! Lo mostro al team oggi e ti rispondo domani.",
      ja: "いいですね!今日チームに見せて、明日お返事します。",
      hi: "अच्छा लग रहा है! आज टीम को दिखाकर कल आपको बताता/बताती हूँ।",
    },
  ],
  revision: [
    {
      en: "Thanks for the draft. Could you make the second option simpler and try a darker colour?",
      de: "Danke für den Entwurf. Könnten Sie die zweite Variante schlichter machen und eine dunklere Farbe ausprobieren?",
      fr: "Merci pour la maquette. Pourriez-vous simplifier la deuxième option et essayer une couleur plus foncée ?",
      es: "Gracias por el borrador. ¿Podrías simplificar la segunda opción y probar un color más oscuro?",
      it: "Grazie per la bozza. Potresti semplificare la seconda opzione e provare un colore più scuro?",
      ja: "ドラフトありがとうございます。2案目をもう少しシンプルにして、濃い色も試していただけますか?",
      hi: "ड्राफ़्ट के लिए धन्यवाद। क्या आप दूसरा विकल्प थोड़ा सरल कर सकते हैं और एक गहरा रंग आज़मा सकते हैं?",
    },
    {
      en: "Of course. I'll send the revised version within two days.",
      de: "Natürlich. Die überarbeitete Version schicke ich innerhalb von zwei Tagen.",
      fr: "Bien sûr. Je vous envoie la version révisée d'ici deux jours.",
      es: "Claro. Te envío la versión corregida en dos días.",
      it: "Certo. Ti mando la versione rivista entro due giorni.",
      ja: "承知しました。2日以内に修正版をお送りします。",
      hi: "ज़रूर। मैं दो दिन में संशोधित संस्करण भेज दूँगा/दूँगी।",
    },
  ],
  thanks: [
    {
      en: "Accepted, thank you {freelancer}! We'd like to work with you again next quarter.",
      de: "Angenommen, vielen Dank {freelancer}! Wir würden im nächsten Quartal gern wieder mit Ihnen arbeiten.",
      fr: "Accepté, merci {freelancer} ! Nous aimerions retravailler avec vous le trimestre prochain.",
      es: "¡Aceptado, gracias {freelancer}! Nos gustaría volver a trabajar contigo el próximo trimestre.",
      it: "Accettato, grazie {freelancer}! Vorremmo lavorare di nuovo con te il prossimo trimestre.",
      ja: "承認しました。{freelancer}さん、ありがとうございました!来期もぜひお願いしたいです。",
      hi: "स्वीकार कर लिया, धन्यवाद {freelancer}! हम अगली तिमाही फिर आपके साथ काम करना चाहेंगे।",
    },
    {
      en: "Thank you {client}, it was a pleasure. Send me a brief whenever you're ready.",
      de: "Danke {client}, es war mir eine Freude. Schicken Sie mir einfach ein Briefing, wenn es so weit ist.",
      fr: "Merci {client}, ce fut un plaisir. Envoyez-moi un brief quand vous serez prêts.",
      es: "Gracias {client}, fue un placer. Envíame un brief cuando quieras.",
      it: "Grazie {client}, è stato un piacere. Mandami un brief quando sei pronto.",
      ja: "{client}さん、ありがとうございました。準備ができたらいつでも依頼内容をお送りください。",
      hi: "धन्यवाद {client}, आपके साथ काम करके अच्छा लगा। जब भी तैयार हों, ब्रीफ़ भेज दीजिए।",
    },
  ],
};

/** Fills {service}, {client}, {freelancer}. */
export function fill(text: string, v: { service: string; client: string; freelancer: string }): string {
  return text.replaceAll("{service}", v.service).replaceAll("{client}", v.client).replaceAll("{freelancer}", v.freelancer);
}

/** Brief texts per service category, in the client's language. */
export const BRIEFS: Record<string, Record<Lang, { title: string; description: string }>> = {
  Design: {
    en: { title: "New logo and look for our brand", description: "We are relaunching our brand next quarter and need a modern logo, colours and a few templates. Our customers are families and small businesses." },
    de: { title: "Neues Logo und Auftritt für unsere Marke", description: "Wir starten unsere Marke im nächsten Quartal neu und brauchen ein modernes Logo, Farben und einige Vorlagen. Unsere Kunden sind Familien und kleine Unternehmen." },
    fr: { title: "Nouveau logo et nouvelle image pour notre marque", description: "Nous relançons notre marque le trimestre prochain et avons besoin d'un logo moderne, de couleurs et de quelques modèles. Nos clients sont des familles et des petites entreprises." },
    es: { title: "Nuevo logotipo e imagen para nuestra marca", description: "Relanzamos nuestra marca el próximo trimestre y necesitamos un logotipo moderno, colores y algunas plantillas. Nuestros clientes son familias y pequeñas empresas." },
    it: { title: "Nuovo logo e immagine per il nostro marchio", description: "Rilanciamo il marchio il prossimo trimestre e ci servono un logo moderno, i colori e qualche modello. I nostri clienti sono famiglie e piccole imprese." },
    ja: { title: "ブランドの新しいロゴとデザイン", description: "来期にブランドをリニューアルします。モダンなロゴ、配色、いくつかのテンプレートが必要です。顧客は家族連れや中小企業です。" },
    hi: { title: "हमारे ब्रांड के लिए नया लोगो और लुक", description: "हम अगली तिमाही में अपना ब्रांड फिर से लॉन्च कर रहे हैं और हमें एक आधुनिक लोगो, रंग और कुछ टेम्पलेट चाहिए। हमारे ग्राहक परिवार और छोटे व्यवसाय हैं।" },
  },
  Translation: {
    en: { title: "Translate our product documentation", description: "About 5,000 words of user guides and UI text need translating before our launch abroad. Consistent terminology matters more than speed." },
    de: { title: "Übersetzung unserer Produktdokumentation", description: "Rund 5.000 Wörter Benutzerhandbücher und UI-Texte müssen vor unserem Auslandsstart übersetzt werden. Einheitliche Terminologie ist wichtiger als Tempo." },
    fr: { title: "Traduire notre documentation produit", description: "Environ 5 000 mots de guides utilisateur et de textes d'interface à traduire avant notre lancement à l'étranger. La cohérence de la terminologie compte plus que la rapidité." },
    es: { title: "Traducir la documentación de nuestro producto", description: "Unas 5.000 palabras de guías de usuario y textos de interfaz para traducir antes de nuestro lanzamiento en el extranjero. La terminología coherente importa más que la rapidez." },
    it: { title: "Tradurre la documentazione del nostro prodotto", description: "Circa 5.000 parole tra guide utente e testi dell'interfaccia da tradurre prima del lancio all'estero. La coerenza terminologica conta più della velocità." },
    ja: { title: "製品ドキュメントの翻訳", description: "海外展開の前に、ユーザーガイドとUIテキスト約5,000語を翻訳したいです。スピードより用語の統一を重視します。" },
    hi: { title: "हमारे प्रोडक्ट दस्तावेज़ों का अनुवाद", description: "विदेश में लॉन्च से पहले लगभग 5,000 शब्दों की यूज़र गाइड और UI टेक्स्ट का अनुवाद करना है। गति से ज़्यादा एक जैसी शब्दावली ज़रूरी है।" },
  },
  Development: {
    en: { title: "Customer portal in React", description: "We need a small customer portal: login, order history and a support form, connected to our existing API. Mobile first." },
    de: { title: "Kundenportal mit React", description: "Wir brauchen ein kleines Kundenportal: Login, Bestellhistorie und Supportformular, angebunden an unsere bestehende API. Mobile first." },
    fr: { title: "Portail client en React", description: "Nous avons besoin d'un petit portail client : connexion, historique des commandes et formulaire d'assistance, relié à notre API existante. Mobile d'abord." },
    es: { title: "Portal de clientes en React", description: "Necesitamos un pequeño portal de clientes: inicio de sesión, historial de pedidos y formulario de soporte, conectado a nuestra API. Primero móvil." },
    it: { title: "Portale clienti in React", description: "Ci serve un piccolo portale clienti: login, storico ordini e modulo di assistenza, collegato alla nostra API esistente. Mobile first." },
    ja: { title: "Reactで顧客ポータルを開発", description: "ログイン、注文履歴、問い合わせフォームを備えた小さな顧客ポータルを、既存のAPIと連携して作りたいです。モバイル優先です。" },
    hi: { title: "React में ग्राहक पोर्टल", description: "हमें एक छोटा ग्राहक पोर्टल चाहिए: लॉगिन, ऑर्डर इतिहास और सहायता फ़ॉर्म, हमारी मौजूदा API से जुड़ा हुआ। पहले मोबाइल।" },
  },
  Video: {
    en: { title: "Edit our monthly YouTube videos", description: "We film one 12-minute video a month and want it edited with captions, plus three short clips for social media." },
    de: { title: "Schnitt unserer monatlichen YouTube-Videos", description: "Wir drehen jeden Monat ein 12-minütiges Video und möchten es mit Untertiteln schneiden lassen, dazu drei kurze Clips für Social Media." },
    fr: { title: "Montage de nos vidéos YouTube mensuelles", description: "Nous tournons une vidéo de 12 minutes par mois et voulons un montage avec sous-titres, plus trois extraits courts pour les réseaux." },
    es: { title: "Editar nuestros videos mensuales de YouTube", description: "Grabamos un video de 12 minutos al mes y queremos editarlo con subtítulos, además de tres clips cortos para redes." },
    it: { title: "Montaggio dei nostri video YouTube mensili", description: "Giriamo un video di 12 minuti al mese e vogliamo il montaggio con sottotitoli, più tre clip brevi per i social." },
    ja: { title: "毎月のYouTube動画の編集", description: "毎月12分ほどの動画を撮影しています。字幕付きの編集と、SNS用のショート動画3本をお願いしたいです。" },
    hi: { title: "हमारे मासिक YouTube वीडियो की एडिटिंग", description: "हम हर महीने 12 मिनट का एक वीडियो शूट करते हैं और उसे कैप्शन के साथ एडिट करवाना चाहते हैं, साथ में सोशल मीडिया के लिए तीन छोटे क्लिप।" },
  },
  Writing: {
    en: { title: "Website copy for our relaunch", description: "Our home page and three product pages need new copy that explains what we do in plain words and gets more demo requests." },
    de: { title: "Website-Texte für unseren Relaunch", description: "Unsere Startseite und drei Produktseiten brauchen neue Texte, die einfach erklären, was wir tun, und mehr Demo-Anfragen bringen." },
    fr: { title: "Textes du site pour notre refonte", description: "Notre page d'accueil et trois pages produit ont besoin de nouveaux textes qui expliquent simplement ce que nous faisons et génèrent plus de demandes de démo." },
    es: { title: "Textos web para nuestro relanzamiento", description: "Nuestra página de inicio y tres páginas de producto necesitan textos nuevos que expliquen de forma sencilla lo que hacemos y consigan más solicitudes de demo." },
    it: { title: "Testi del sito per il nostro rilancio", description: "La home page e tre pagine prodotto hanno bisogno di nuovi testi che spieghino in modo semplice cosa facciamo e portino più richieste di demo." },
    ja: { title: "リニューアルするWebサイトの文章", description: "トップページと製品ページ3つについて、事業内容をわかりやすく伝え、デモ依頼を増やす文章をお願いしたいです。" },
    hi: { title: "हमारे रीलॉन्च के लिए वेबसाइट कॉपी", description: "हमारे होम पेज और तीन प्रोडक्ट पेजों के लिए नई कॉपी चाहिए, जो आसान शब्दों में बताए कि हम क्या करते हैं और ज़्यादा डेमो अनुरोध लाए।" },
  },
  "3D": {
    en: { title: "3D renders for our new product line", description: "We are launching four kitchen products and need clean renders on white plus one lifestyle scene each. We can send CAD files." },
    de: { title: "3D-Renderings für unsere neue Produktlinie", description: "Wir bringen vier Küchenprodukte heraus und brauchen saubere Renderings auf Weiß sowie je eine Lifestyle-Szene. CAD-Dateien können wir schicken." },
    fr: { title: "Rendus 3D pour notre nouvelle gamme", description: "Nous lançons quatre produits de cuisine et avons besoin de rendus sur fond blanc et d'une mise en scène pour chacun. Nous pouvons fournir les fichiers CAO." },
    es: { title: "Renders 3D para nuestra nueva línea", description: "Lanzamos cuatro productos de cocina y necesitamos renders sobre fondo blanco y una escena de ambiente para cada uno. Podemos enviar archivos CAD." },
    it: { title: "Render 3D per la nostra nuova linea", description: "Lanciamo quattro prodotti per la cucina e ci servono render su fondo bianco e un'ambientazione per ciascuno. Possiamo inviare i file CAD." },
    ja: { title: "新製品ラインの3Dレンダリング", description: "キッチン用品4点を発売します。白背景のレンダリングと、各製品の使用シーンを1枚ずつお願いしたいです。CADデータを提供できます。" },
    hi: { title: "हमारी नई प्रोडक्ट लाइन के लिए 3D रेंडर", description: "हम चार किचन प्रोडक्ट लॉन्च कर रहे हैं और हर एक के लिए सफ़ेद बैकग्राउंड पर रेंडर और एक लाइफ़स्टाइल दृश्य चाहिए। हम CAD फ़ाइलें भेज सकते हैं।" },
  },
  Illustration: {
    en: { title: "Illustrations for a picture book", description: "I have written a 24-page picture book about a fox who learns to swim and need a cover and twelve spreads." },
    de: { title: "Illustrationen für ein Bilderbuch", description: "Ich habe ein 24-seitiges Bilderbuch über einen Fuchs geschrieben, der schwimmen lernt, und brauche ein Cover und zwölf Doppelseiten." },
    fr: { title: "Illustrations pour un album jeunesse", description: "J'ai écrit un album de 24 pages sur un renard qui apprend à nager et j'ai besoin d'une couverture et de douze doubles pages." },
    es: { title: "Ilustraciones para un álbum infantil", description: "Escribí un álbum de 24 páginas sobre un zorro que aprende a nadar y necesito una portada y doce dobles páginas." },
    it: { title: "Illustrazioni per un albo illustrato", description: "Ho scritto un albo di 24 pagine su una volpe che impara a nuotare e mi servono una copertina e dodici tavole doppie." },
    ja: { title: "絵本のイラスト", description: "泳ぎを覚えるキツネの24ページの絵本を書きました。表紙と見開き12枚のイラストをお願いしたいです。" },
    hi: { title: "चित्र-पुस्तक के लिए चित्र", description: "मैंने तैरना सीखने वाली एक लोमड़ी पर 24 पन्नों की चित्र-पुस्तक लिखी है और मुझे एक कवर और बारह दो-पन्ने वाले चित्र चाहिए।" },
  },
  Data: {
    en: { title: "Sales dashboard for our team", description: "Our sales data lives in spreadsheets and a CRM export. We want one dashboard that updates weekly and shows revenue by region." },
    de: { title: "Vertriebs-Dashboard für unser Team", description: "Unsere Vertriebsdaten liegen in Tabellen und einem CRM-Export. Wir möchten ein Dashboard, das sich wöchentlich aktualisiert und den Umsatz nach Region zeigt." },
    fr: { title: "Tableau de bord des ventes pour notre équipe", description: "Nos données de vente sont dans des tableurs et un export CRM. Nous voulons un tableau de bord mis à jour chaque semaine, avec le chiffre d'affaires par région." },
    es: { title: "Dashboard de ventas para nuestro equipo", description: "Nuestros datos de ventas están en hojas de cálculo y una exportación del CRM. Queremos un dashboard que se actualice cada semana y muestre los ingresos por región." },
    it: { title: "Dashboard vendite per il nostro team", description: "I nostri dati di vendita sono in fogli di calcolo e in un export del CRM. Vogliamo una dashboard aggiornata ogni settimana con il fatturato per regione." },
    ja: { title: "チーム向け売上ダッシュボード", description: "売上データはスプレッドシートとCRMのエクスポートにあります。毎週更新され、地域別の売上がわかるダッシュボードがほしいです。" },
    hi: { title: "हमारी टीम के लिए सेल्स डैशबोर्ड", description: "हमारा सेल्स डेटा स्प्रेडशीट और CRM एक्सपोर्ट में है। हमें एक डैशबोर्ड चाहिए जो हर हफ़्ते अपडेट हो और क्षेत्र के अनुसार राजस्व दिखाए।" },
  },
};
