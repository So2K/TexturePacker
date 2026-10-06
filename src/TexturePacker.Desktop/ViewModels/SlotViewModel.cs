using System.IO;
using System.Windows.Media;
using TexturePacker.Core;
using TexturePacker.Desktop.Infrastructure;

namespace TexturePacker.Desktop.ViewModels;

public sealed class SlotViewModel : ObservableObject
{
    private readonly MainViewModel _owner;
    private CancellationTokenSource? _loadCancellation;
    private long _loadVersion;
    private string? _filePath;
    private ImageSource? _preview;
    private string _metadata = "No image selected";
    private string? _errorMessage;
    private bool _fillWhite;
    private bool _isLoading;

    internal SlotViewModel(MainViewModel owner, string id, string label, string hint, Color accent,
        bool fillWhite = false, bool allowFallback = true)
    {
        _owner = owner;
        Id = id;
        Label = label;
        Hint = hint;
        _fillWhite = fillWhite;
        AllowFallback = allowFallback;
        var brush = new SolidColorBrush(accent);
        brush.Freeze();
        AccentBrush = brush;
        BrowseCommand = new AsyncRelayCommand(_ => _owner.BrowseSlotAsync(this), _ => CanEdit, _owner.ReportError);
        RemoveCommand = new RelayCommand(_ => Clear(), _ => CanEdit && (HasFile || IsLoading || HasError));
        WhiteCommand = new RelayCommand(_ => FillWhite = true, _ => CanEdit && AllowFallback);
        BlackCommand = new RelayCommand(_ => FillWhite = false, _ => CanEdit && AllowFallback);
    }

    public string Id { get; private set; }
    public string Label { get; private set; }
    public string Hint { get; }
    public Brush AccentBrush { get; }
    public bool AllowFallback { get; }
    public string? FilePath => _filePath;
    public string FileName => _filePath is null ? "Choose image" : Path.GetFileName(_filePath);
    public ImageSource? Preview => _preview;
    public bool HasFile => _filePath is not null;
    public string Metadata => _metadata;
    public string? ErrorMessage => _errorMessage;
    public bool HasError => !string.IsNullOrWhiteSpace(_errorMessage);
    public bool IsLoading => _isLoading;
    public bool CanEdit => _owner.CanEdit;
    public string FillLabel => _fillWhite ? "White · 255" : "Black · 0";
    public bool FillWhite
    {
        get => _fillWhite;
        set
        {
            if (!CanEdit || !SetProperty(ref _fillWhite, value)) return;
            OnPropertyChanged(nameof(FillLabel));
            _owner.OnInputChanged();
        }
    }

    public AsyncRelayCommand BrowseCommand { get; }
    public RelayCommand RemoveCommand { get; }
    public RelayCommand WhiteCommand { get; }
    public RelayCommand BlackCommand { get; }

    internal (long Version, CancellationToken Token) BeginLoad()
    {
        CancelPendingLoad();
        _loadCancellation = new CancellationTokenSource();
        _isLoading = true;
        _errorMessage = null;
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(ErrorMessage));
        OnPropertyChanged(nameof(HasError));
        NotifyCommands();
        return (_loadVersion, _loadCancellation.Token);
    }

    internal bool CompleteLoad(long version, string path, TexturePreview data, ImageSource image)
    {
        if (version != _loadVersion) return false;
        _filePath = path;
        _preview = image;
        _metadata = $"{data.Width:N0} × {data.Height:N0} · {data.BitDepth}-bit";
        _errorMessage = null;
        EndLoad();
        NotifyFileProperties();
        return true;
    }

    internal bool FailLoad(long version, string? error)
    {
        if (version != _loadVersion) return false;
        _errorMessage = error;
        EndLoad();
        OnPropertyChanged(nameof(ErrorMessage));
        OnPropertyChanged(nameof(HasError));
        NotifyCommands();
        return true;
    }

    internal void UpdateAtlasPosition(int index, int columns)
    {
        Id = $"atlas_{index}";
        Label = $"Tile {index + 1} · {index % columns + 1}, {index / columns + 1}";
        OnPropertyChanged(nameof(Id));
        OnPropertyChanged(nameof(Label));
    }

    internal void CancelPendingLoad()
    {
        _loadVersion++;
        _loadCancellation?.Cancel();
        _loadCancellation?.Dispose();
        _loadCancellation = null;
        if (_isLoading)
        {
            _isLoading = false;
            OnPropertyChanged(nameof(IsLoading));
        }
        NotifyCommands();
    }

    internal void Clear()
    {
        if (!CanEdit) return;
        CancelPendingLoad();
        _filePath = null;
        _preview = null;
        _metadata = "No image selected";
        _errorMessage = null;
        NotifyFileProperties();
        _owner.OnInputChanged();
    }

    internal void NotifyCanEdit()
    {
        OnPropertyChanged(nameof(CanEdit));
        NotifyCommands();
    }

    private void EndLoad()
    {
        _isLoading = false;
        _loadCancellation?.Dispose();
        _loadCancellation = null;
        OnPropertyChanged(nameof(IsLoading));
        NotifyCommands();
    }

    private void NotifyFileProperties()
    {
        OnPropertyChanged(nameof(FilePath));
        OnPropertyChanged(nameof(FileName));
        OnPropertyChanged(nameof(Preview));
        OnPropertyChanged(nameof(HasFile));
        OnPropertyChanged(nameof(Metadata));
        OnPropertyChanged(nameof(ErrorMessage));
        OnPropertyChanged(nameof(HasError));
        NotifyCommands();
    }

    private void NotifyCommands()
    {
        BrowseCommand.NotifyCanExecuteChanged();
        RemoveCommand.NotifyCanExecuteChanged();
        WhiteCommand.NotifyCanExecuteChanged();
        BlackCommand.NotifyCanExecuteChanged();
    }
}
