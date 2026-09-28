(function () {
  "use strict";

  const CONFIG = {
    tipo: "usuario",
    maxNomesFila: 4,
    vinculosOperadorContato: {}
  };

  const INTERVALO = 30000;
  const INTERVALO_RESPOSTA = 120000;
  const INTERVALO_ABERTOS = 1080000;
  const INTERVALO_FILA = 4 * 60 * 1000;
  const URL_DIGISAC = `${window.location.origin}/`;

  const CHAVE_RESP = "digisac_ultimaResposta";
  const CHAVE_ABERTO = "digisac_ultimoAberto";
  const CHAVE_FILA = "digisac_ultimaFila";
  function lerTempo(chave) { return parseInt(GM_getValue(chave, "0"), 10) || 0; }
  function gravarTempo(chave, val) { GM_setValue(chave, String(val)); }

  // Fase 3: lock de lider entre abas (evita notificacao duplicada na mesma maquina)
  const TAB_ID = Math.random().toString(36).slice(2);
  const LOCK_KEY = "digisac_lock";
  const LOCK_TTL = 10000;
  function adquirirLock() {
    const agora = Date.now();
    let lock = null;
    try { lock = JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); } catch (e) { lock = null; }
    if (!lock || lock.expira < agora) {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ id: TAB_ID, expira: agora + LOCK_TTL }));
      return true;
    }
    return lock.id === TAB_ID;
  }

  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }

  function textoLimpo(texto) {
    return (texto || "").replace(/\s+/g, " ").trim();
  }

  function normalizar(texto) {
    return textoLimpo(texto).toLowerCase();
  }

  function numeroNoTexto(texto) {
    const numero = parseInt(textoLimpo(texto).match(/\d+/)?.[0] || "", 10);
    return isNaN(numero) ? 0 : numero;
  }

  function botaoPorTexto(regex) {
    return Array.from(document.querySelectorAll("button")).find((botao) => {
      return regex.test(textoLimpo(botao.textContent));
    });
  }

  function elementoEstaAtivo(elemento) {
    if (!elemento) return false;

    const atributos = ["aria-selected", "aria-pressed", "data-state", "data-active"];
    if (atributos.some((nome) => /^(true|active|selected)$/i.test(elemento.getAttribute(nome) || ""))) {
      return true;
    }

    return /\b(active|selected|current)\b/i.test(elemento.className || "");
  }

  function numeroBadge(seletorAba) {
    const aba = document.querySelector(seletorAba);
    if (!aba) return 0;

    const badge =
      aba.querySelector("span.text-sidebar-label") ||
      aba.querySelector(".badge.badge-primary.badge-pill") ||
      aba.querySelector(".badge.badge-primary") ||
      aba.querySelector("[class*='badge']") ||
      aba.querySelector("[class*='pill']") ||
      aba.querySelector("[class*='count']") ||
      aba.querySelector("[class*='counter']");

    if (!badge) return numeroNoTexto(aba.textContent);

    const numero = parseInt(textoLimpo(badge.textContent), 10);
    return isNaN(numero) ? numeroNoTexto(aba.textContent) : numero;
  }

  function quantidadeFila() {
    const porTestid = numeroBadge(
      '[data-testid="chat-tab-queue_calls"], [data-testid*="queue-calls"], [data-testid*="queue_calls"], [data-testid*="queue"]'
    );
    if (porTestid > 0) return porTestid;

    const botaoFila = botaoPorTexto(/^fila\b/i);
    const porBotao = numeroNoTexto(botaoFila?.textContent);
    if (porBotao > 0) return porBotao;

    const badges = Array.from(
      document.querySelectorAll(".badge, [class*='badge'], [class*='pill'], [class*='count'], [class*='counter']")
    );
    for (const badge of badges) {
      const title = (badge.getAttribute("title") || "").toLowerCase();
      if (/fila/.test(title) || /chamados?\s+na\s+fila/.test(title)) {
        const n = parseInt(textoLimpo(badge.textContent), 10);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return 0;
  }

  function quantidadeChatsComigo() {
    const porTestid = numeroBadge('[data-testid="chat-tab-mine"]');
    if (porTestid > 0) return porTestid;

    const botaoMinhas = botaoPorTexto(/^minhas\b/i);
    const porBotao = numeroNoTexto(botaoMinhas?.textContent);
    if (porBotao > 0) return porBotao;

    // No layout novo, "Minhas" pode não exibir contador. Só conta a lista
    // quando a própria aba informa que está selecionada.
    if (elementoEstaAtivo(botaoMinhas)) return contatosVisiveis().length;
    return 0;
  }

  function contatoDaLinha(linha) {
    const nomeElemento =
      linha.querySelector("h5") ||
      linha.querySelector("[data-testid^='contact_internalName-']") ||
      linha.querySelector(".chat-contact-name") ||
      linha.querySelector(".contact-name") ||
      linha.querySelector("[class*='contact'][class*='name' i]") ||
      linha.querySelector("[class*='name' i]");

    const nome = textoLimpo(nomeElemento ? nomeElemento.textContent : linha.textContent);
    if (!nome) return null;

    const id =
      linha.getAttribute("data-id") ||
      linha.getAttribute("data-contact-id") ||
      linha.dataset.id ||
      linha.dataset.contactId ||
      linha.getAttribute("data-chat-id") ||
      linha.getAttribute("href")?.split("/").pop() ||
      "";

    return {
      id,
      nome,
      url: id ? `${URL_DIGISAC}chat/${id}` : URL_DIGISAC
    };
  }

  function contatosVisiveis() {
    const seletores = [
      "[data-testid='contact_item-button-select']",
      ".chatContactDiv",
      "[data-testid*='chat-contact']",
      "[class*='chatContact']",
      "[class*='contact-item']",
      "[class*='conversation']"
    ];

    const linhas = new Set();
    seletores.forEach((seletor) => {
      document.querySelectorAll(seletor).forEach((linha) => linhas.add(linha));
    });

    return Array.from(linhas)
      .map(contatoDaLinha)
      .filter(Boolean)
      .filter((contato, indice, lista) => {
        const chave = contato.id || normalizar(contato.nome);
        return lista.findIndex((item) => (item.id || normalizar(item.nome)) === chave) === indice;
      });
  }

  function dadosFila() {
    const total = quantidadeFila();
    if (!total) {
      return { total: 0, contatos: [] };
    }

    return {
      total,
      contatos: contatosVisiveis().slice(0, Math.max(total, CONFIG.maxNomesFila))
    };
  }

  function operadorAtual() {
    const elemento =
      document.querySelector(".user-profile-email") ||
      document.querySelector("[data-testid*='user'][data-testid*='email']") ||
      document.querySelector("[class*='user'][class*='email' i]") ||
      document.querySelector("[class*='profile'][class*='email' i]");

    return elemento ? normalizar(elemento.textContent) : "";
  }

  function contatosDoOperador(operador) {
    if (!operador) return [];

    const vinculos = CONFIG.vinculosOperadorContato;
    const contatos = vinculos[operador] || vinculos[normalizar(operador)] || [];

    return contatos.map(normalizar).filter(Boolean);
  }

  function filtrarFilaPorOperador(contatos, operador) {
    const contatosVinculados = contatosDoOperador(operador);
    if (!contatosVinculados.length) return contatos;

    return contatos.filter((contato) => {
      const nome = normalizar(contato.nome);
      const id = normalizar(contato.id);

      return contatosVinculados.some((vinculo) => {
        return nome.includes(vinculo) || vinculo.includes(nome) || (id && id === vinculo);
      });
    });
  }

  function resumoContatos(contatos, totalOriginal) {
    if (!contatos.length) return "";

    const nomes = contatos.slice(0, CONFIG.maxNomesFila).map((contato) => contato.nome);
    const restantes = Math.max(totalOriginal - nomes.length, 0);

    return restantes > 0 ? `${nomes.join(", ")} e +${restantes} outro(s)` : nomes.join(", ");
  }

  function abrirDigisac(url) {
    const destino = url || URL_DIGISAC;

    window.focus();

    if (destino !== URL_DIGISAC && destino !== window.location.href) {
      window.location.href = destino;
    }
  }

  function notificar(mensagem, url) {
    const destino = url || URL_DIGISAC;

    if (typeof GM_notification === "function") {
      GM_notification({
        title: "DIGISAC",
        text: mensagem,
        timeout: 10000,
        onclick: () => abrirDigisac(destino)
      });
      return;
    }

    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const notificacao = new Notification("DIGISAC", { body: mensagem });
    notificacao.onclick = () => {
      abrirDigisac(destino);
      notificacao.close();
    };

    setTimeout(() => notificacao.close(), 10000);
  }

  function quantidadeChatsAguardando() {
    const totalChats = quantidadeChatsComigo();
    if (!totalChats) return 0;

    const contatos = document.querySelectorAll(
      "[data-testid='contact_item-button-select'], .chatContactDiv, [data-testid*='chat-contact']"
    );
    if (!contatos.length) return totalChats;

    let aguardandoResposta = 0;
    contatos.forEach((contato) => {
      const ultimaMensagem = contato.querySelector("[data-testid='last-message-text']");
      if (!ultimaMensagem) return;

      const mensagemEnviadaPeloOperador = contato.querySelector(
        "button svg.lucide-check-check"
      );
      if (!mensagemEnviadaPeloOperador) {
        aguardandoResposta++;
      }
    });

    return aguardandoResposta;
  }

  function verificar() {
    try {
    const chatsComigo = quantidadeChatsComigo();
    const chatsAguardando = quantidadeChatsAguardando();
    const fila = dadosFila();
    const operador = operadorAtual();
    const contatosFila = filtrarFilaPorOperador(fila.contatos, operador);
    const operadorTemFiltro = contatosDoOperador(operador).length > 0;
    const totalFilaNotificavel = operadorTemFiltro ? contatosFila.length : fila.total;

    console.log(
      `[Digisac ${CONFIG.tipo}] ${new Date().toLocaleTimeString()} | Chats comigo: ${chatsComigo} | Aguardando resposta: ${chatsAguardando} | Fila: ${fila.total}`
    );

    const agora = Date.now();
    const souLider = adquirirLock();

    if (chatsAguardando > 0 && agora - lerTempo(CHAVE_RESP) >= INTERVALO_RESPOSTA) {
      if (souLider) notificar(`• ${chatsAguardando} atendimento(s) aguardando sua resposta`, URL_DIGISAC);
      gravarTempo(CHAVE_RESP, agora);
    }

    if (chatsComigo > 0 && agora - lerTempo(CHAVE_ABERTO) >= INTERVALO_ABERTOS) {
      if (souLider) notificar(`• ${chatsComigo} ATENÇÃO! Atendimento se encerrando em 2 minutos!`, URL_DIGISAC);
      gravarTempo(CHAVE_ABERTO, agora);
    }

    if (totalFilaNotificavel > 0 && agora - lerTempo(CHAVE_FILA) >= INTERVALO_FILA) {
      const contatosParaMensagem = operadorTemFiltro ? contatosFila : fila.contatos;
      const nomes = resumoContatos(contatosParaMensagem, totalFilaNotificavel);
      const detalhe = nomes ? `: ${nomes}` : "";
      const url = contatosParaMensagem[0] ? contatosParaMensagem[0].url : URL_DIGISAC;

      if (souLider) notificar(`• ${totalFilaNotificavel} chamado(s) na fila${detalhe}`, url);
      gravarTempo(CHAVE_FILA, agora);
    }
    } catch (e) {
      console.warn("[Digisac " + CONFIG.tipo + "] erro em verificar():", e);
    }
  }

  setTimeout(verificar, 500);

  // Fase 2: MutationObserver reage a mudancas no DOM em vez de polling fixo
  let _timerObserver = null;
  const _agendar = (delay) => {
    if (_timerObserver) clearTimeout(_timerObserver);
    _timerObserver = setTimeout(verificar, delay || 1000);
  };
  const _observer = new MutationObserver(() => _agendar(1000));
  _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  // fallback <= 1 min (re-checa a fila com mais frequencia caso o observer perca a mudanca)
  setInterval(verificar, 60 * 1000);
})();
