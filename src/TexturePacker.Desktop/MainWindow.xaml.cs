using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using TexturePacker.Desktop.ViewModels;

namespace TexturePacker.Desktop;

public partial class MainWindow : Window
{
    public MainViewModel ViewModel { get; } = new();

    public MainWindow()
    {
        InitializeComponent();
        DataContext = ViewModel;
        ViewModel.PropertyChanged += ViewModel_PropertyChanged;
        Closed += (_, _) => ViewModel.Dispose();
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MainViewModel.Preview) or nameof(MainViewModel.HasResult))
            Dispatcher.BeginInvoke(UpdatePreviewSize);
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
    private void ZoomChoice_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdatePreviewSize();

    private void UpdatePreviewSize()
    {
        if (OutputImage is null || PreviewScroll is null || ZoomChoice is null || ViewModel.Preview is not BitmapSource bitmap) return;
        var scale = ZoomChoice.SelectedIndex switch { 1 => 1d, 2 => 2d, 3 => 4d, _ => Math.Min(Math.Max(1, PreviewScroll.ActualWidth - 48) / bitmap.PixelWidth, Math.Max(1, PreviewScroll.ActualHeight - 48) / bitmap.PixelHeight) };
        OutputImage.Width = bitmap.PixelWidth * scale;
        OutputImage.Height = bitmap.PixelHeight * scale;
    }

    private void OpenWeb_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo("https://so2k.github.io/TexturePacker/") { UseShellExecute = true }); }
        catch (Win32Exception) { MessageBox.Show(this, "Open https://so2k.github.io/TexturePacker/ in your browser.", "Web version"); }
    }
}
