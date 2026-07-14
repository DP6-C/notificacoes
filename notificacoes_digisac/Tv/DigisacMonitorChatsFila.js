(function () {
    "use strict";

    const CONFIG = {
        tipo: "tv",
        maxNomesFila: 4,
        vinculosOperadorContato: {}
    };

    const INTERVALO = 30000;
    const INTERVALO_RESPOSTA = 120000;
    const INTERVALO_ABERTOS = 1080000;
    const INTERVALO_FILA = 120000;
    const URL_DIGISAC = `${window.location.origin}/`;

    let ultimaResposta = 0;
    let ultimoAberto = 0;
    let ultimaFila = 0;

    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    function textoLimpo(texto) {
        return (texto || "").replace(/\s+/g, " ").trim();
    }

    function normalizar(texto) {
        return textoLimpo(texto).toLowerCase();
    }

    function numeroBadge(seletorAba) {
        const aba = document.querySelector(seletorAba);
        if (!aba) return 0;

        const badge =
            aba.querySelector(".badge.badge-primary.badge-pill") ||
            aba.querySelector(".badge.badge-primary") ||
            aba.querySelector("[class*='badge']");

        if (!badge) return 0;

        const numero = parseInt(textoLimpo(badge.textContent), 10);
        return isNaN(numero) ? 0 : numero;
    }

    function quantidadeFila() {
        return numeroBadge('[data-testid="chat-tab-queue_calls"], [data-testid*="queue-calls"]');
    }

    function quantidadeChatsComigo() {
        return numeroBadge('[data-testid="chat-tab-mine"]');
    }

    function contatoDaLinha(linha) {
        const nomeElemento =
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
            "";

        return {
            id,
            nome,
            url: id ? `${URL_DIGISAC}chat/${id}` : URL_DIGISAC
        };
    }

    function contatosVisiveis() {
        const seletores = [
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
        window.focus();

        if (typeof GM_openInTab === "function") {
            GM_openInTab(url || URL_DIGISAC, { active: true, insert: true, setParent: true });
            return;
        }

        window.open(url || URL_DIGISAC, "_blank", "noopener,noreferrer");
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

        const contatos = document.querySelectorAll(".chatContactDiv");
        if (!contatos.length) return totalChats;

        let aguardandoResposta = 0;
        contatos.forEach((contato) => {
            const wrapper = contato.querySelector(".last-message-wrapper");
            if (!wrapper) return;

            const checkOperador = wrapper.querySelector("svg");
            if (!checkOperador) {
                aguardandoResposta++;
            }
        });

        return aguardandoResposta;
    }

    function verificar() {
        const chatsComigo = quantidadeChatsComigo();
        const chatsAguardando = quantidadeChatsAguardando();
        const fila = dadosFila();
        const operador = operadorAtual();
        const contatosFila = filtrarFilaPorOperador(fila.contatos, operador);
        const totalFilaNotificavel = fila.total;

        console.log(
            `[Digisac ${CONFIG.tipo}] ${new Date().toLocaleTimeString()} | Chats comigo: ${chatsComigo} | Aguardando resposta: ${chatsAguardando} | Fila: ${fila.total}`
        );

        const agora = Date.now();

        if (chatsAguardando > 0 && agora - ultimaResposta >= INTERVALO_RESPOSTA) {
            notificar(`• ${chatsAguardando} atendimento(s) aguardando sua resposta`, URL_DIGISAC);
            ultimaResposta = agora;
        }

        if (chatsComigo > 0 && agora - ultimoAberto >= INTERVALO_ABERTOS) {
            notificar(`• ${chatsComigo} atendimento(s) com você`, URL_DIGISAC);
            ultimoAberto = agora;
        }

        if (totalFilaNotificavel > 0 && agora - ultimaFila >= INTERVALO_FILA) {
            const nomes = resumoContatos(contatosFila, totalFilaNotificavel);
            const detalhe = nomes ? `: ${nomes}` : "";
            const url = contatosFila[0] ? contatosFila[0].url : URL_DIGISAC;

            notificar(`• ${totalFilaNotificavel} chamado(s) na fila${detalhe}`, url);
            ultimaFila = agora;
        }
    }

    setTimeout(verificar, 500);
    setInterval(verificar, INTERVALO);
})();
