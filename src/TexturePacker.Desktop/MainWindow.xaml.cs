using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TexturePacker.Desktop.ViewModels;

namespace TexturePacker.Desktop;

public partial class MainWindow : Window
{
    private double? _zoomScale;
    public MainViewModel ViewModel { get; } = new();

    public MainWindow()
    {
        InitializeComponent();
        DataContext = ViewModel;
        // The native Fluent theme already supplies Mica on supported Windows 11 builds.
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
            Background = (Brush)FindResource("CanvasBrush");
        ViewModel.PropertyChanged += ViewModel_PropertyChanged;
        UpdateSelectedPresets();
        Closed += (_, _) => ViewModel.Dispose();
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MainViewModel.InvertR) or nameof(MainViewModel.InvertG)
            or nameof(MainViewModel.InvertB) or nameof(MainViewModel.InvertA)
            or nameof(MainViewModel.AtlasColumns) or nameof(MainViewModel.AtlasRows))
            UpdateSelectedPresets();
        if (e.PropertyName is nameof(MainViewModel.Preview) or nameof(MainViewModel.HasResult)
            or nameof(MainViewModel.SourcePreview) or nameof(MainViewModel.HasViewportTexture)
            or nameof(MainViewModel.AtlasColumns) or nameof(MainViewModel.AtlasRows))
            Dispatcher.BeginInvoke(UpdatePreviewSize);
    }

    private void UpdateSelectedPresets()
    {
        (Button Button, bool Selected)[] presets =
        [
            (Grid2x2, ViewModel.AtlasColumns == 2 && ViewModel.AtlasRows == 2),
            (Grid3x3, ViewModel.AtlasColumns == 3 && ViewModel.AtlasRows == 3),
            (Grid4x4, ViewModel.AtlasColumns == 4 && ViewModel.AtlasRows == 4),
            (Grid2x3, ViewModel.AtlasColumns == 2 && ViewModel.AtlasRows == 3),
            (RoughPreset, ViewModel.InvertR && ViewModel.InvertG && ViewModel.InvertB && !ViewModel.InvertA),
            (GreenPreset, !ViewModel.InvertR && ViewModel.InvertG && !ViewModel.InvertB && !ViewModel.InvertA),
            (AlphaPreset, !ViewModel.InvertR && !ViewModel.InvertG && !ViewModel.InvertB && ViewModel.InvertA),
            (AllPreset, ViewModel.InvertR && ViewModel.InvertG && ViewModel.InvertB && ViewModel.InvertA)
        ];
        foreach (var (button, selected) in presets)
        {
            if (button is null) continue;
            button.Background = (Brush)FindResource(selected ? "SelectedBrush" : "CardBrush");
            button.BorderBrush = (Brush)FindResource(selected ? "AccentBrush" : "BorderBrush");
        }
    }

    private void Window_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = ViewModel.CanEdit && e.Data.GetDataPresent(DataFormats.FileDrop)
            ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private async void Window_Drop(object sender, DragEventArgs e)
    {
        if (!ViewModel.CanEdit || e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
        e.Handled = true;
        await ViewModel.LoadFilesAsync(files);
    }

    private async void Slot_Drop(object sender, DragEventArgs e)
    {
        e.Handled = true;
        if (!ViewModel.CanEdit || e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
        if (sender is FrameworkElement { DataContext: SlotViewModel slot })
            await ViewModel.LoadFilesAsync(files, slot);
    }

    private void PreviewScroll_SizeChanged(object sender, SizeChangedEventArgs e) => UpdatePreviewSize();
    private void PreviewZoom_Click(object sender, RoutedEventArgs e)
    {
        _zoomScale = sender is MenuItem { Tag: string value } && double.TryParse(value, out var scale) ? scale : null;
        UpdatePreviewSize();
    }

    private void AtlasPreset_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.CanEdit || sender is not Button { Tag: string dimensions }) return;
        var parts = dimensions.Split(',');
        ViewModel.AtlasColumns = int.Parse(parts[0]);
        ViewModel.AtlasRows = int.Parse(parts[1]);
    }

    private void AtlasValue_Commit(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.CanEdit || sender is not TextBox box) return;
        var value = int.TryParse(box.Text, out var parsed) ? parsed : 1;
        if (box.Tag?.ToString() == "columns") ViewModel.AtlasColumns = value;
        else ViewModel.AtlasRows = value;
        box.GetBindingExpression(TextBox.TextProperty)?.UpdateTarget();
    }

    private void AtlasValue_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        AtlasValue_Commit(sender, e);
    }

    private void UpdatePreviewSize()
    {
        if (ViewportArea is null || WorkspaceRoot is null || AtlasCanvas is null) return;
        var side = Math.Min(WorkspaceRoot.ActualHeight * .7, WorkspaceRoot.ActualWidth * .7);
        AtlasCanvas.Width = side + 2;
        AtlasCanvas.Height = Math.Min(side * ViewModel.AtlasRows / ViewModel.AtlasColumns, WorkspaceRoot.ActualHeight * .75) + 2;
        if (OutputImage?.Source is not BitmapSource bitmap) return;
        var maxWidth = Math.Max(1, ViewportArea.ActualWidth - 98);
        var maxHeight = Math.Max(1, Math.Min(ViewportArea.ActualHeight - 98, WorkspaceRoot.ActualHeight * .75));
        var scale = _zoomScale ?? Math.Min(1, Math.Min(maxWidth / bitmap.PixelWidth, maxHeight / bitmap.PixelHeight));
        OutputImage.Width = bitmap.PixelWidth * scale;
        OutputImage.Height = bitmap.PixelHeight * scale;
    }

    private void OpenWeb_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo("https://so2k.github.io/TexturePacker/") { UseShellExecute = true }); }
        catch (Win32Exception) { MessageBox.Show(this, "Open https://so2k.github.io/TexturePacker/ in your browser.", "Web version"); }
    }
}
