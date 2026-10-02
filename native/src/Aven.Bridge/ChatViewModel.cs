using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Aven.Bridge;

/// <summary>Rôle d'une ligne du chat (bulle) — parité MessageBubble de web/src.</summary>
public enum ChatRowKind
{
    User,
    Agent,
    Tools,
    Form,
    Error,
}

/// <summary>
/// Une bulle du chat. Classe (pas record) car l'UI bind ses propriétés notifiées :
/// un delta de stream patche le Text de la bulle existante (append incrémental,
/// pas de recréation de la ligne ni de re-render des autres).
/// </summary>
public sealed class ChatRow : INotifyPropertyChanged
{
    private string _text = "";
    private string? _meta;
    private string? _tools;
    private string? _question;
    private string? _answer;

    public ChatRow(ChatRowKind kind, string text, string? meta = null)
    {
        Kind = kind;
        _text = text;
        _meta = meta;
    }

    public ChatRowKind Kind { get; }
    public bool IsUser => Kind == ChatRowKind.User;
    public bool IsAgent => Kind == ChatRowKind.Agent;
    public bool HasTools => Tools is { Length: > 0 };
    public bool HasForm => Question is { Length: > 0 };

    public string Text { get => _text; private set => Set(ref _text, value); }
    public string? Meta { get => _meta; private set => Set(ref _meta, value); }
    /// <summary>Résumé des outils de ce tour (« read ✓ · bash ✗ »).</summary>
    public string? Tools { get => _tools; private set { Set(ref _tools, value); On(); } }
    public string? Question { get => _question; private set { Set(ref _question, value); On(); } }
    /// <summary>Réponse déjà envoyée à la question (affichée une fois répondue).</summary>
    public string? Answer { get => _answer; private set { Set(ref _answer, value); On(); } }

    public event PropertyChangedEventHandler? PropertyChanged;

    internal void Patch(string text, string? meta)
    {
        Text = text;
        Meta = meta;
    }

    internal void PatchTools(string tools) => Tools = tools;

    internal void PatchForm(string question, string? answer = null)
    {
        Question = question;
        Answer = answer;
    }

    private void On([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

/// <summary>
/// Vue-modèle du chat (phase 3) : transforme le flux <see cref="ConversationLive"/>
/// en lignes affichables, SANS WinUI — testable en xUnit pur. Le diff est
/// incrémental par construction :
///  · les bulles déjà connues sont PATCHÉES (INPC) et restent à leur place ;
///  · seules les nouvelles apparaissent (Insert à l'index d'ordre du Live) ;
///  · le drapeau « follow bottom » n'est armé que si l'utilisateur y était.
/// La parité de transformation est testée ligne à ligne dans ChatViewModelTests.
/// </summary>
public sealed class ChatViewModel
{
    private readonly ConversationClient _client;
    private readonly string _workspace;
    private readonly Action<Action>? _marshal;
    private readonly List<(string Id, ChatRow Row)> _agentRows = [];
    private readonly Dictionary<string, ChatRow> _formRows = [];

    /// <summary>Conversation ouverte (id du chat principal, pour la sémantique child).</summary>
    public string ChatId { get; private set; } = "";

    public ObservableCollection<ChatRow> Rows { get; } = [];

    /// <summary>L'utilisateur est au bas du fil — les prochains append doivent y rester (parité « Dernier message »).</summary>
    public bool FollowBottom { get; set; } = true;

    public bool Busy => _client.Live.Busy;
    public string? Error => _client.Live.Error;

    /// <param name="marshal">Dans l'UI : marshal sur le thread interface (DispatcherQueue) —
    /// les événements du moteur arrivent sur le thread de lecture du flux. Null en tests.</param>
    public ChatViewModel(ConversationClient client, string workspace, Action<Action>? marshal = null)
    {
        _client = client;
        _workspace = workspace;
        _marshal = marshal;
    }

    /// <summary>Snapshot Live courant (badge autorisations/questions, Arrêter, erreurs).</summary>
    public ConversationLive Live => _client.Live;

    /// <summary>Écoute le client et transforme chaque snapshot en diff de lignes. Idempotent.</summary>
    public void Attach(string chatId)
    {
        ChatId = chatId;
        _client.LiveChanged -= OnLive;
        _client.LiveChanged += OnLive;
        OnLive(_client.Live);
    }

    public void Detach() => _client.LiveChanged -= OnLive;

    // ── Transformations Live → lignes ─────────────────────────────────────────

    private void OnLive(ConversationLive live)
    {
        if (_marshal is { } poster) { poster(() => Diffuser(live)); return; }
        Diffuser(live);
    }

    private void Diffuser(ConversationLive live)
    {
        // Bulles agent : une par assistantMessageID, patchées au fil des deltas.
        foreach (var id in live.Order)
        {
            var message = live.Texts[id];
            var existante = _agentRows.Find(e => e.Id == id).Row;
            var meta = MetaDe(live, id, message.Child);
            if (existante is null)
            {
                var ligne = new ChatRow(ChatRowKind.Agent, message.Text, meta);
                _agentRows.Add((id, ligne));
                Rows.Add(ligne);
            }
            else
            {
                existante.Patch(message.Text, meta);
            }
        }

        // Résumé d'outils : accroché à la DERNIÈRE bulle agent (parité MessageBubble).
        var outilId = live.Tools.Keys.LastOrDefault();
        if (outilId is { } && _agentRows.Count > 0)
        {
            var resume = string.Join(" · ", live.Tools.Values
                .GroupBy(t => t.Name)
                .Select(g => g.Count() > 1 ? $"{g.Key} ×{g.Count()}" : g.Key));
            _agentRows[^1].Row.PatchTools(resume);
        }

        // Questions de l'agent : une ligne par formId ; la réponse enrichit la ligne.
        foreach (var form in live.Forms)
        {
            if (_formRows.ContainsKey(form.Id)) continue;
            var ligne = new ChatRow(ChatRowKind.Form, "");
            ligne.PatchForm(FormLabel(form), null);
            _formRows[form.Id] = ligne;
            Rows.Add(ligne);
        }

        // Erreur de tour : ligne dédiée (parité MessageBubble error).
        var erreur = live.Error;
        if (erreur is { } && (Rows.Count == 0 || Rows[^1].Kind != ChatRowKind.Error || Rows[^1].Text != erreur))
            Rows.Add(new ChatRow(ChatRowKind.Error, erreur));

        OnPropertyChanged(nameof(Busy));
        OnPropertyChanged(nameof(Error));
    }

    private static string FormLabel(AgentForm form) =>
        Jsonx.S(Jsonx.At(form.Raw, "title")) ?? "L'agent a une question";

    private static string? MetaDe(ConversationLive live, string id, bool child)
    {
        // Pas de modèle fiable pendant le stream : on n'affiche rien de inventé.
        return child ? "sous-agent" : null;
    }

    // ── Actions interface ─────────────────────────────────────────────────────

    public Task<(string Id, string Title, string Agent, string Model)> CreateChatAsync(
        string agent, CancellationToken cancellation = default) =>
        _client.CreateChatAsync(agent, _workspace, cancellation);

    /// <summary>Ouvre une conversation EXISTANTE (parité openConversation) : reset des
    /// lignes, relecture du transcript complet (sous-agents inclus, tri chronologique)
    /// puis branchement live. Les bulles agent chargées sont enregistrées dans
    /// _agentRows (id = assistantMessageID) : un delta qui arrive pendant ou après la
    /// relecture PATCH la ligne au lieu d'en créer une doublon.</summary>
    public async Task AttachExistingAsync(string chatId, CancellationToken cancellation = default)
    {
        var messages = await _client.MessagesAsync(chatId, _workspace, cancellation).ConfigureAwait(false);

        var lignes = new List<(string Id, ChatRow Row)>();
        foreach (var m in messages)
        {
            if (m.Role == "user")
            {
                lignes.Add(("", new ChatRow(ChatRowKind.User, m.Text)));
                continue;
            }
            var ligne = new ChatRow(ChatRowKind.Agent, m.Text, m.Child ? "sous-agent" : null);
            if (m.Tools is { Count: > 0 })
            {
                ligne.PatchTools(string.Join(" · ", m.Tools
                    .GroupBy(t => t.Name)
                    .Select(g => g.Count() > 1 ? $"{g.Key} ×{g.Count()}" : g.Key)));
            }
            lignes.Add((m.Id, ligne));
            if (m.Error is { Length: > 0 }) lignes.Add(("", new ChatRow(ChatRowKind.Error, m.Error)));
        }

        void Remplir()
        {
            _agentRows.Clear();
            _formRows.Clear();
            Rows.Clear();
            foreach (var (id, ligne) in lignes)
            {
                Rows.Add(ligne);
                if (id.Length > 0) _agentRows.Add((id, ligne));
            }
            FollowBottom = true;
            OnPropertyChanged(nameof(Busy));
            OnPropertyChanged(nameof(Error));
        }

        Attach(chatId); // abonnement live : les événements ne sont pas perdus pendant la relecture
        if (_marshal is { } poster) poster(Remplir); else Remplir();
    }

    public async Task SendAsync(string text, CancellationToken cancellation = default)
    {
        var clean = text.Trim();
        if (clean.Length == 0) return;
        FollowBottom = true;
        Rows.Add(new ChatRow(ChatRowKind.User, clean));
        await _client.SendAsync(ChatId, clean, cancellation).ConfigureAwait(false);
    }

    /// <summary>Arrête le tour en cours (Échap / bouton Arrêter) — best effort.</summary>
    public Task StopAsync(CancellationToken cancellation = default) =>
        _client.InterruptAsync(ChatId, cancellation);

    public Task ReplyPermissionAsync(string requestId, string decision, CancellationToken cancellation = default) =>
        _client.ReplyPermissionAsync(ChatId, requestId, decision, cancellation);

    public async Task ReplyFormAsync(string formId, object answer, CancellationToken cancellation = default)
    {
        if (_formRows.TryGetValue(formId, out var ligne))
        {
            ligne.PatchForm(ligne.Question ?? "Question", string.Join(", ", answer.GetType().GetProperties().Select(p => $"{p.GetValue(answer)}")));
            _formRows.Remove(formId);
        }
        await _client.ReplyFormAsync(ChatId, formId, answer, cancellation).ConfigureAwait(false);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
