using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using TexturePacker.Core;
using TexturePacker.Desktop.Infrastructure;

namespace TexturePacker.Desktop.ViewModels;

public sealed class MainViewModel : ObservableObject, IDisposable
{
    public const string TextureFileFilter =
        "Texture images|*.png;*.jpg;*.jpeg;*.tif;*.tiff;*.tga;*.bmp;*.webp|PNG images|*.png|TIFF images|*.tif;*.tiff|All files|*.*";

    private readonly TextureProcessor _processor;
    private readonly Dictionary<TextureMode, ObservableCollection<SlotViewModel>> _modeSlots = [];
    private readonly Dictionary<(int Column, int Row), SlotViewModel> _atlasCoordinates = [];
    private ModeOption _selectedMode;
    private TextureResult? _result;
    private ImageSource? _preview;
    private CancellationTokenSource? _operationCancellation;
    private string _status = "Ready. Add images or choose a fill for each channel.";
    private string? _errorMessage;
    private bool _isProcessing;
    private bool _isSaving;
    private bool _disposed;
    private int _activeLoadCount;
    private int _atlasColumns = 4;
    private int _atlasRows = 4;
    private bool _invertR = true;
    private bool _invertG = true;
    private bool _invertB = true;
    private bool _invertA;
    private long _inputRevision;

    public MainViewModel() : this(new TextureProcessor()) { }

    public MainViewModel(TextureProcessor processor)
    {
        _processor = processor;
        Modes = new ObservableCollection<ModeOption>
        {
            new(TextureMode.ChannelPacking, "Channel packing", "Pack grayscale maps into the red, green, blue and alpha channels.", "\uE8B9"),
            new(TextureMode.CombineAlpha, "Combine alpha", "Add a grayscale alpha mask to a color texture.", "\uE8A1"),
            new(TextureMode.Convert16To8, "16 → 8 bit", "Convert a 16-bit TIFF texture to a standard 8-bit PNG.", "\uE8FB"),
            new(TextureMode.Atlas, "Texture atlas", "Arrange images in a grid. Drop several files to fill empty tiles.", "\uE80A"),
            new(TextureMode.InvertMap, "Invert map", "Switch gloss and roughness, or flip selected texture channels.", "\uE7A7")
        };
        _selectedMode = Modes[0];

        OpenCommand = new AsyncRelayCommand(_ => BrowseFilesAsync(), _ => CanEdit, ReportError);
        ProcessCommand = new AsyncRelayCommand(_ => ProcessAsync(), _ => CanProcess, ReportError);
        SaveCommand = new AsyncRelayCommand(_ => SaveAsync(), _ => HasResult && !IsBusy, ReportError);
        CancelCommand = new RelayCommand(_ => Cancel(), _ => IsProcessing || IsLoading);
        ClearCommand = new RelayCommand(_ => ClearActiveSlots(), _ => CanEdit && Slots.Any(s => s.HasFile || s.IsLoading || s.HasError));
        InvertPresetCommand = new RelayCommand(ApplyInvertPreset, _ => CanEdit);
        DismissErrorCommand = new RelayCommand(_ => ErrorMessage = null, _ => HasError);

        _modeSlots[TextureMode.ChannelPacking] = new ObservableCollection<SlotViewModel>
        {
            Slot("R", "Red Channel", "Grayscale → R", Color.FromRgb(242, 123, 129), true),
            Slot("G", "Green Channel", "Grayscale → G", Color.FromRgb(125, 211, 152), true),
            Slot("B", "Blue Channel", "Grayscale → B", Color.FromRgb(129, 165, 246)),
            Slot("A", "Alpha Channel", "Grayscale → A", Color.FromRgb(178, 188, 205), true)
        };
        _modeSlots[TextureMode.CombineAlpha] = new ObservableCollection<SlotViewModel>
        {
            Slot("base", "Base Texture (RGB)", "Color texture → RGB", Color.FromRgb(153, 145, 245)),
            Slot("alpha", "Alpha Mask (Grayscale)", "White = opaque · Black = transparent", Color.FromRgb(178, 188, 205), true)
        };
        _modeSlots[TextureMode.Convert16To8] = new ObservableCollection<SlotViewModel>
        {
            Slot("tif", "Source 16-bit TIF", "Select a .tif or .tiff image", Color.FromRgb(125, 211, 152))
        };
        _modeSlots[TextureMode.InvertMap] = new ObservableCollection<SlotViewModel>
        {
            Slot("invert_src", "Source Texture Map (Gloss / Rough / Normal)", "Gloss, roughness or normal map", Color.FromRgb(234, 189, 118))
        };
        _modeSlots[TextureMode.Atlas] = [];
        RebuildAtlasSlots();
    }

    public ObservableCollection<ModeOption> Modes { get; }
    public ModeOption SelectedMode
    {
        get => _selectedMode;
        set
        {
            if (value is null || !CanEdit || !SetProperty(ref _selectedMode, value)) return;
            OnPropertyChanged(nameof(Slots));
            OnPropertyChanged(nameof(IsAtlasMode));
            OnPropertyChanged(nameof(IsInvertMode));
            OnPropertyChanged(nameof(IsConvertMode));
            OnPropertyChanged(nameof(ActionLabel));
            OnPropertyChanged(nameof(InputSummary));
            OnInputChanged();
            Status = "Ready. " + value.Description;
        }
    }
    public ObservableCollection<SlotViewModel> Slots => _modeSlots[_selectedMode.Mode];
    public ImageSource? Preview => _preview;
    public ImageSource? SourcePreview => Slots.FirstOrDefault(s => s.Preview is not null)?.Preview;
    public bool HasViewportTexture => HasResult || (IsInvertMode && SourcePreview is not null);
    public bool HasResult => _result is not null;
    public string ResultInfo => _result is null ? "No result yet" : $"{_result.Width:N0} × {_result.Height:N0} · RGBA · 8-bit PNG";
    public string Status { get => _status; private set => SetProperty(ref _status, value); }
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (!SetProperty(ref _errorMessage, value)) return;
            OnPropertyChanged(nameof(HasError));
            DismissErrorCommand.NotifyCanExecuteChanged();
        }
    }
    public bool HasError => !string.IsNullOrWhiteSpace(ErrorMessage);
    public bool IsProcessing => _isProcessing;
    public bool IsSaving => _isSaving;
    public bool IsLoading => _activeLoadCount > 0;
    public bool IsBusy => IsProcessing || IsSaving || IsLoading;
    public bool CanEdit => !_disposed && !IsProcessing && !IsSaving;
    public bool CanProcess => CanEdit && !IsLoading &&
        (SelectedMode.Mode is TextureMode.ChannelPacking or TextureMode.CombineAlpha || Slots.Any(s => s.HasFile));
    public bool IsAtlasMode => SelectedMode.Mode == TextureMode.Atlas;
    public bool IsInvertMode => SelectedMode.Mode == TextureMode.InvertMap;
    public bool IsConvertMode => SelectedMode.Mode == TextureMode.Convert16To8;
    public string InputSummary => $"{Slots.Count(s => s.HasFile)} of {Slots.Count} {(IsAtlasMode ? "tiles" : "inputs")} loaded";
    public string ActionLabel => SelectedMode.Mode switch
    {
        TextureMode.ChannelPacking => "Pack channels",
        TextureMode.CombineAlpha => "Combine texture",
        TextureMode.Convert16To8 => "Convert to 8 bit",
        TextureMode.Atlas => "Build atlas",
        TextureMode.InvertMap => "Invert texture",
        _ => "Process texture"
    };

    public int AtlasColumns
    {
        get => _atlasColumns;
        set
        {
            if (!CanEdit || !SetProperty(ref _atlasColumns, Math.Clamp(value, 1, 20))) return;
            RebuildAtlasSlots();
            OnInputChanged();
        }
    }
    public int AtlasRows
    {
        get => _atlasRows;
        set
        {
            if (!CanEdit || !SetProperty(ref _atlasRows, Math.Clamp(value, 1, 20))) return;
            RebuildAtlasSlots();
            OnInputChanged();
        }
    }
    public bool InvertR { get => _invertR; set => SetInvert(ref _invertR, value, nameof(InvertR)); }
    public bool InvertG { get => _invertG; set => SetInvert(ref _invertG, value, nameof(InvertG)); }
    public bool InvertB { get => _invertB; set => SetInvert(ref _invertB, value, nameof(InvertB)); }
    public bool InvertA { get => _invertA; set => SetInvert(ref _invertA, value, nameof(InvertA)); }

    public AsyncRelayCommand OpenCommand { get; }
    public AsyncRelayCommand ProcessCommand { get; }
    public AsyncRelayCommand SaveCommand { get; }
    public RelayCommand CancelCommand { get; }
    public RelayCommand ClearCommand { get; }
    public RelayCommand InvertPresetCommand { get; }
    public RelayCommand DismissErrorCommand { get; }

    public async Task LoadFilesAsync(IEnumerable<string> paths, SlotViewModel? startSlot = null)
    {
        if (!CanEdit) return;
        var sources = paths.Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
        if (sources.Length == 0) return;
        ErrorMessage = null;
        var available = Slots.Where(s => !s.HasFile && !s.IsLoading).ToList();
        if (startSlot is not null)
        {
            var startIndex = Slots.IndexOf(startSlot);
            if (startIndex < 0) return;
            if (IsAtlasMode)
            {
                // A cell drop follows the original atlas order, replacing occupied cells after its target.
                available = Slots.Skip(startIndex).Take(sources.Length).ToList();
            }
            else
            {
                available.Remove(startSlot);
                available.Insert(0, startSlot);
            }
        }
        else if (available.Count == 0 && Slots.Count == 1)
        {
            // Dropping a new image onto a single-source mode replaces its current source.
            available.Add(Slots[0]);
        }
        if (available.Count == 0)
        {
            Status = "All inputs are filled. Drop onto an input to replace its image, or clear an input first.";
            return;
        }

        var count = Math.Min(sources.Length, available.Count);
        var ignoredCount = sources.Length - count;
        var completed = 0;
        // Reserve all destinations before awaiting so separate drops cannot select the same empty slot.
        var work = Enumerable.Range(0, count)
            .Select(i => (Slot: available[i], Path: sources[i], Load: available[i].BeginLoad()))
            .ToArray();
        _activeLoadCount += work.Length;
        UpdateBusyProperties();
        OnInputChanged();
        Status = $"Loading {count} {(count == 1 ? "image" : "images")}…";
        foreach (var item in work)
        {
            try
            {
                item.Load.Token.ThrowIfCancellationRequested();
                var path = Path.GetFullPath(item.Path);
                if (item.Slot.Id == "tif" && Path.GetExtension(path).ToLowerInvariant() is not (".tif" or ".tiff"))
                    throw new TextureProcessingException("The 16-bit converter requires a .tif or .tiff file.");
                if (!File.Exists(path)) throw new FileNotFoundException("The selected image no longer exists.", path);
                var data = await _processor.CreatePreviewAsync(path, 512, item.Load.Token);
                item.Load.Token.ThrowIfCancellationRequested();
                var preview = ImageLoader.FromPng(data.PngBytes);
                if (item.Slot.CompleteLoad(item.Load.Version, path, data, preview))
                {
                    completed++;
                    OnInputChanged();
                }
            }
            catch (OperationCanceledException)
            {
                item.Slot.FailLoad(item.Load.Version, null);
            }
            catch (Exception error)
            {
                var message = $"{Path.GetFileName(item.Path)}: {ReadableError(error)}";
                if (item.Slot.FailLoad(item.Load.Version, message)) ErrorMessage = message;
            }
            finally
            {
                _activeLoadCount--;
                UpdateBusyProperties();
                OnPropertyChanged(nameof(InputSummary));
            }
        }
        if (_disposed || IsLoading) return;
        Status = completed > 0
            ? $"Loaded {completed} {(completed == 1 ? "image" : "images")}. " +
                (HasError ? "Some images could not be loaded. Check the highlighted inputs." :
                ignoredCount > 0 ? $"{ignoredCount} skipped because there are no more available inputs." : "Ready to process.")
            : HasError ? "Some images could not be loaded. Check the highlighted inputs." : "Image loading canceled.";
    }

    internal async Task BrowseSlotAsync(SlotViewModel slot)
    {
        if (!CanEdit) return;
        var dialog = new OpenFileDialog
        {
            Title = $"Choose image for {slot.Label}",
            Filter = IsConvertMode ? "TIFF images|*.tif;*.tiff" : TextureFileFilter,
            Multiselect = false,
            CheckFileExists = true
        };
        if (ShowDialog(dialog) == true) await LoadFilesAsync(dialog.FileNames, slot);
    }

    private async Task BrowseFilesAsync()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Add texture images",
            Filter = IsConvertMode ? "TIFF images|*.tif;*.tiff" : TextureFileFilter,
            Multiselect = true,
            CheckFileExists = true
        };
        if (ShowDialog(dialog) == true) await LoadFilesAsync(dialog.FileNames);
    }

    private async Task ProcessAsync()
    {
        if (!CanProcess) return;
        ErrorMessage = null;
        InvalidateResult();
        var revision = _inputRevision;
        var mode = SelectedMode.Mode;
        var inputs = Slots.Select(s => new TextureInput(s.Id, s.FilePath, s.FillWhite)).ToArray();
        var options = new PackOptions(AtlasColumns, AtlasRows, new InvertChannels(InvertR, InvertG, InvertB, InvertA));
        using var cancellation = new CancellationTokenSource();
        _operationCancellation = cancellation;
        _isProcessing = true;
        UpdateBusyProperties();
        Status = "Processing texture…";
        try
        {
            var result = await _processor.ProcessAsync(mode, inputs, options, cancellation.Token);
            cancellation.Token.ThrowIfCancellationRequested();
            if (_disposed || revision != _inputRevision) return;
            _preview = ImageLoader.FromPng(result.PngBytes);
            _result = result;
            OnPropertyChanged(nameof(Preview));
            OnPropertyChanged(nameof(HasResult));
            OnPropertyChanged(nameof(ResultInfo));
            NotifyViewportProperties();
            Status = $"Done. {result.Width:N0} × {result.Height:N0} PNG is ready to save.";
        }
        catch (OperationCanceledException) { Status = "Processing canceled."; }
        catch (Exception error) { ReportError(error); }
        finally
        {
            _operationCancellation = null;
            _isProcessing = false;
            UpdateBusyProperties();
        }
    }

    private async Task SaveAsync()
    {
        if (_result is null || IsBusy) return;
        var result = _result;
        var stem = SelectedMode.Mode switch
        {
            TextureMode.ChannelPacking => "packed_channels",
            TextureMode.CombineAlpha => "texture_with_alpha",
            TextureMode.Convert16To8 => "texture_8bit",
            TextureMode.Atlas => "texture_atlas",
            TextureMode.InvertMap => "inverted_texture",
            _ => "texture"
        };
        var dialog = new SaveFileDialog
        {
            Title = "Save processed texture",
            Filter = "PNG image|*.png",
            DefaultExt = ".png",
            AddExtension = true,
            OverwritePrompt = true,
            FileName = $"{stem}_{result.Width}x{result.Height}.png"
        };
        if (ShowDialog(dialog) != true) return;
        ErrorMessage = null;
        _isSaving = true;
        UpdateBusyProperties();
        Status = "Saving PNG…";
        string? temporaryPath = null;
        try
        {
            var destination = Path.GetFullPath(dialog.FileName);
            temporaryPath = Path.Combine(Path.GetDirectoryName(destination)!, $".texturepacker-{Guid.NewGuid():N}.tmp");
            await File.WriteAllBytesAsync(temporaryPath, result.PngBytes);
            File.Move(temporaryPath, destination, overwrite: true);
            temporaryPath = null;
            Status = $"Saved {Path.GetFileName(destination)}.";
        }
        catch (Exception error) { ReportError(error); }
        finally
        {
            if (temporaryPath is not null)
            {
                try { File.Delete(temporaryPath); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            _isSaving = false;
            UpdateBusyProperties();
        }
    }

    internal void OnInputChanged()
    {
        _inputRevision++;
        InvalidateResult();
        NotifyViewportProperties();
        OnPropertyChanged(nameof(InputSummary));
        OnPropertyChanged(nameof(CanProcess));
        NotifyCommands();
        if (!IsBusy) Status = "Inputs updated. Ready to process.";
    }

    internal void ReportError(Exception error)
    {
        ErrorMessage = ReadableError(error);
        Status = "The operation could not be completed.";
    }

    private void InvalidateResult()
    {
        if (_result is null && _preview is null) return;
        _result = null;
        _preview = null;
        OnPropertyChanged(nameof(Preview));
        OnPropertyChanged(nameof(HasResult));
        OnPropertyChanged(nameof(ResultInfo));
        NotifyViewportProperties();
        SaveCommand.NotifyCanExecuteChanged();
    }

    private void NotifyViewportProperties()
    {
        OnPropertyChanged(nameof(SourcePreview));
        OnPropertyChanged(nameof(HasViewportTexture));
    }

    private void SetInvert(ref bool field, bool value, string propertyName)
    {
        if (!CanEdit || !SetProperty(ref field, value, propertyName)) return;
        OnInputChanged();
    }

    private void ApplyInvertPreset(object? parameter)
    {
        var preset = parameter?.ToString()?.ToLowerInvariant();
        var values = preset switch
        {
            "rgb" => (true, true, true, false),
            "green" or "g" => (false, true, false, false),
            "alpha" or "a" => (false, false, false, true),
            "all" or "rgba" => (true, true, true, true),
            _ => (_invertR, _invertG, _invertB, _invertA)
        };
        if (values == (_invertR, _invertG, _invertB, _invertA)) return;
        (_invertR, _invertG, _invertB, _invertA) = values;
        OnPropertyChanged(nameof(InvertR));
        OnPropertyChanged(nameof(InvertG));
        OnPropertyChanged(nameof(InvertB));
        OnPropertyChanged(nameof(InvertA));
        OnInputChanged();
    }

    private void RebuildAtlasSlots()
    {
        // Preserve cells by coordinate, while discarded rows/columns must release their images and pending decodes.
        foreach (var coordinate in _atlasCoordinates.Keys
                     .Where(c => c.Column >= AtlasColumns || c.Row >= AtlasRows).ToArray())
        {
            _atlasCoordinates[coordinate].CancelPendingLoad();
            _atlasCoordinates.Remove(coordinate);
        }
        var current = _modeSlots[TextureMode.Atlas];
        current.Clear();
        for (var row = 0; row < AtlasRows; row++)
        for (var column = 0; column < AtlasColumns; column++)
        {
            if (!_atlasCoordinates.TryGetValue((column, row), out var slot))
            {
                slot = Slot("", "", "Drop an image into this tile", Color.FromRgb(178, 188, 205), allowFallback: false);
                _atlasCoordinates[(column, row)] = slot;
            }
            slot.UpdateAtlasPosition(row * AtlasColumns + column, AtlasColumns);
            current.Add(slot);
        }
        OnPropertyChanged(nameof(InputSummary));
    }

    private SlotViewModel Slot(string id, string label, string hint, Color accent,
        bool fillWhite = false, bool allowFallback = true) => new(this, id, label, hint, accent, fillWhite, allowFallback);

    private void ClearActiveSlots()
    {
        foreach (var slot in Slots.Where(s => s.HasFile || s.IsLoading || s.HasError)) slot.Clear();
        ErrorMessage = null;
        Status = "Inputs cleared.";
    }

    private void Cancel()
    {
        _operationCancellation?.Cancel();
        foreach (var slot in AllSlots()) slot.CancelPendingLoad();
        Status = IsProcessing ? "Canceling processing…" : "Image loading canceled.";
        NotifyCommands();
    }

    private IEnumerable<SlotViewModel> AllSlots() =>
        _modeSlots.Values.SelectMany(slots => slots).Concat(_atlasCoordinates.Values).Distinct();

    private void UpdateBusyProperties()
    {
        OnPropertyChanged(nameof(IsProcessing));
        OnPropertyChanged(nameof(IsSaving));
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(IsBusy));
        OnPropertyChanged(nameof(CanEdit));
        OnPropertyChanged(nameof(CanProcess));
        foreach (var slot in AllSlots()) slot.NotifyCanEdit();
        NotifyCommands();
    }

    private void NotifyCommands()
    {
        OpenCommand.NotifyCanExecuteChanged();
        ProcessCommand.NotifyCanExecuteChanged();
        SaveCommand.NotifyCanExecuteChanged();
        CancelCommand.NotifyCanExecuteChanged();
        ClearCommand.NotifyCanExecuteChanged();
        InvertPresetCommand.NotifyCanExecuteChanged();
    }

    private static bool? ShowDialog(CommonDialog dialog)
    {
        var owner = Application.Current?.MainWindow;
        return owner?.IsVisible == true ? dialog.ShowDialog(owner) : dialog.ShowDialog();
    }

    private static string ReadableError(Exception error) => error switch
    {
        UnauthorizedAccessException => "Access was denied. Choose a readable source or a writable save folder.",
        OutOfMemoryException => "This image is too large for the available memory. Try a smaller image or atlas.",
        _ => string.IsNullOrWhiteSpace(error.Message) ? "An unexpected error occurred. Please try again." : error.Message
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _operationCancellation?.Cancel();
        foreach (var slot in AllSlots()) slot.CancelPendingLoad();
        GC.SuppressFinalize(this);
    }
}
