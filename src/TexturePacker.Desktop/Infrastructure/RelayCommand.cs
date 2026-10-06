using System.Windows.Input;

namespace TexturePacker.Desktop.Infrastructure;

public sealed class RelayCommand(Action<object?> execute, Predicate<object?>? canExecute = null) : ICommand
{
    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => canExecute?.Invoke(parameter) ?? true;
    public void Execute(object? parameter)
    {
        if (CanExecute(parameter)) execute(parameter);
    }
    public void NotifyCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

public sealed class AsyncRelayCommand(
    Func<object?, Task> execute,
    Predicate<object?>? canExecute = null,
    Action<Exception>? onError = null) : ICommand
{
    private bool _isRunning;
    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => !_isRunning && (canExecute?.Invoke(parameter) ?? true);
    public async void Execute(object? parameter) => await ExecuteAsync(parameter);
    public async Task ExecuteAsync(object? parameter = null)
    {
        if (!CanExecute(parameter)) return;
        _isRunning = true;
        NotifyCanExecuteChanged();
        try { await execute(parameter); }
        catch (OperationCanceledException) { }
        catch (Exception error) { onError?.Invoke(error); }
        finally
        {
            _isRunning = false;
            NotifyCanExecuteChanged();
        }
    }
    public void NotifyCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
