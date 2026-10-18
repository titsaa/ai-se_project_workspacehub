import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusPanel } from "../components/StatusPanel";
import { useAuth } from "../hooks/useAuth";
import { bookingService } from "../services/bookingService";
import type { Booking } from "../types/models";
import { formatDateTimeInput } from "../utils/date";
import { canDeleteResources, canEditBooking } from "../utils/permissions";

interface BookingFormState {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
}

type BookingFormErrors = Partial<Record<keyof BookingFormState, string>>;

const isValidDateTime = (value: string) => {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );

  if (!match) {
    return false;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const date = new Date(value);

  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(year) &&
    date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hour) &&
    date.getMinutes() === Number(minute) &&
    date.getSeconds() === Number(second)
  );
};

const validateBookingFormState = (
  formState: BookingFormState,
): BookingFormErrors => {
  const errors: BookingFormErrors = {};
  const title = formState.title.trim();

  if (!title) {
    errors.title = "Title is required";
  } else if (title.length < 2) {
    errors.title = "Title must be at least 2 characters";
  }

  if (!formState.startsAt.trim()) {
    errors.startsAt = "Start time is required";
  } else if (!isValidDateTime(formState.startsAt)) {
    errors.startsAt = "Start time must be a valid date and time";
  }

  if (!formState.endsAt.trim()) {
    errors.endsAt = "End time is required";
  } else if (!isValidDateTime(formState.endsAt)) {
    errors.endsAt = "End time must be a valid date and time";
  } else if (
    isValidDateTime(formState.startsAt) &&
    new Date(formState.endsAt) <= new Date(formState.startsAt)
  ) {
    errors.endsAt = "End time must be after start time";
  }

  return errors;
};

const buildBookingFormState = (booking: Booking): BookingFormState => ({
  title: booking.title,
  description: booking.description,
  startsAt: formatDateTimeInput(booking.startsAt),
  endsAt: formatDateTimeInput(booking.endsAt),
});

export const BookingsPage = () => {
  const { isFeatureEnabled, user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingEdits, setBookingEdits] = useState<
    Record<string, BookingFormState>
  >({});
  const [createState, setCreateState] = useState<BookingFormState>({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
  });
  const [createTouched, setCreateTouched] = useState<
    Partial<Record<keyof BookingFormState, boolean>>
  >({});
  const [editTouched, setEditTouched] = useState<
    Record<string, Partial<Record<keyof BookingFormState, boolean>>>
  >({});
  const [loading, setLoading] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bookingErrors, setBookingErrors] = useState<Record<string, string>>(
    {},
  );
  const createErrors = validateBookingFormState(createState);

  useEffect(() => {
    const loadBookings = async () => {
      if (!isFeatureEnabled("scheduling")) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setCreateError(null);

      try {
        const nextBookings = await bookingService.list();
        setBookings(nextBookings);
        setBookingEdits(
          Object.fromEntries(
            nextBookings.map((booking) => [
              booking._id,
              buildBookingFormState(booking),
            ]),
          ),
        );
      } catch (loadError) {
        setCreateError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load bookings",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadBookings();
  }, [isFeatureEnabled]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateBookingFormState(createState);
    if (Object.keys(errors).length > 0) {
      setCreateTouched({
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
      });
      return;
    }

    try {
      const booking = await bookingService.create(createState);
      setBookings((current) =>
        [...current, booking].sort((left, right) =>
          left.startsAt.localeCompare(right.startsAt),
        ),
      );
      setBookingEdits((current) => ({
        ...current,
        [booking._id]: buildBookingFormState(booking),
      }));
      setCreateState({
        title: "",
        description: "",
        startsAt: "",
        endsAt: "",
      });
      setCreateTouched({});
      setCreateError(null);
    } catch (createError) {
      setCreateError(
        createError instanceof Error
          ? createError.message
          : "Unable to create booking",
      );
    }
  };

  const handleEdit = (
    bookingId: string,
    field: keyof BookingFormState,
    value: string,
  ) => {
    setBookingEdits((current) => ({
      ...current,
      [bookingId]: {
        ...current[bookingId],
        [field]: value,
      },
    }));
  };

  const handleSave = async (bookingId: string) => {
    const formState = bookingEdits[bookingId];
    const errors = validateBookingFormState(formState);
    if (Object.keys(errors).length > 0) {
      setEditTouched((current) => ({
        ...current,
        [bookingId]: {
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
        },
      }));
      return;
    }

    setBookingErrors((current) => ({ ...current, [bookingId]: "" }));

    try {
      const updatedBooking = await bookingService.update(bookingId, formState);
      setBookings((current) =>
        current.map((booking) =>
          booking._id === bookingId ? updatedBooking : booking,
        ),
      );
      setBookingEdits((current) => ({
        ...current,
        [bookingId]: buildBookingFormState(updatedBooking),
      }));
      setEditTouched((current) => {
        const next = { ...current };
        delete next[bookingId];
        return next;
      });
      setBookingErrors((current) => ({ ...current, [bookingId]: "" }));
    } catch (saveError) {
      setBookingErrors((current) => ({
        ...current,
        [bookingId]:
          saveError instanceof Error
            ? saveError.message
            : "Unable to update booking",
      }));
    }
  };

  const handleDelete = async (bookingId: string) => {
    try {
      await bookingService.delete(bookingId);
      setBookings((current) =>
        current.filter((booking) => booking._id !== bookingId),
      );
    } catch (deleteError) {
      setBookingErrors((current) => ({
        ...current,
        [bookingId]:
          deleteError instanceof Error
            ? deleteError.message
            : "Unable to delete booking",
      }));
    }
  };

  if (!isFeatureEnabled("scheduling")) {
    return (
      <StatusPanel
        title="Scheduling disabled"
        message="This page is hidden by the organization feature flags."
      />
    );
  }

  if (loading) {
    return (
      <StatusPanel
        title="Loading bookings"
        message="Fetching schedule items."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Manage simple shared bookings with conflict prevention on the API."
        title="Bookings"
      />
      <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <form
          className="rounded-3xl bg-white p-6 shadow-sm"
          onSubmit={(event) => void handleCreate(event)}
        >
          <h2 className="text-xl font-semibold text-ink">Create booking</h2>
          <div className="mt-4 space-y-4">
            <input
              className="w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 placeholder:text-[#94A3B880]"
              onBlur={() =>
                setCreateTouched((current) => ({ ...current, title: true }))
              }
              onChange={(event) =>
                setCreateState((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Booking title"
              value={createState.title}
            />
            {createTouched.title && createErrors.title ? (
              <p className="text-sm text-danger">{createErrors.title}</p>
            ) : null}
            <textarea
              className="min-h-28 w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 placeholder:text-[#94A3B880]"
              onBlur={() =>
                setCreateTouched((current) => ({
                  ...current,
                  description: true,
                }))
              }
              onChange={(event) =>
                setCreateState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Booking description"
              value={createState.description}
            />
            <input
              className="w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3"
              onBlur={() =>
                setCreateTouched((current) => ({ ...current, startsAt: true }))
              }
              onChange={(event) =>
                setCreateState((current) => ({
                  ...current,
                  startsAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={createState.startsAt}
            />
            {createTouched.startsAt && createErrors.startsAt ? (
              <p className="text-sm text-danger">{createErrors.startsAt}</p>
            ) : null}
            <input
              className="w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3"
              onBlur={() =>
                setCreateTouched((current) => ({ ...current, endsAt: true }))
              }
              onChange={(event) =>
                setCreateState((current) => ({
                  ...current,
                  endsAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={createState.endsAt}
            />
            {createTouched.endsAt && createErrors.endsAt ? (
              <p className="text-sm text-danger">{createErrors.endsAt}</p>
            ) : null}
            {createError ? (
              <p className="text-sm text-danger">{createError}</p>
            ) : null}
            <button
              className="rounded-[12px] bg-ink px-4 py-3 font-medium text-white transition hover:opacity-80 active:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
            >
              Create booking
            </button>
          </div>
        </form>
        {bookings.length ? (
          <ul className="space-y-4">
            {bookings.map((booking) => {
              const canEdit = canEditBooking(user, booking);
              const formState = bookingEdits[booking._id];
              const editErrors = validateBookingFormState(formState);
              const touched = editTouched[booking._id] ?? {};

              return (
                <li key={booking._id}>
                  <article className="rounded-3xl bg-white p-6 shadow-sm">
                    <div className="grid gap-4 md:grid-cols-2">
                      <input
                        className="rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 disabled:bg-slate-100 md:col-span-2"
                        disabled={!canEdit}
                        onBlur={() =>
                          setEditTouched((current) => ({
                            ...current,
                            [booking._id]: {
                              ...current[booking._id],
                              title: true,
                            },
                          }))
                        }
                        onChange={(event) =>
                          handleEdit(booking._id, "title", event.target.value)
                        }
                        value={formState?.title ?? booking.title}
                      />
                      {touched.title && editErrors.title ? (
                        <p className="text-sm text-danger md:col-span-2">
                          {editErrors.title}
                        </p>
                      ) : null}
                      <textarea
                        className="min-h-24 rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 disabled:bg-slate-100 md:col-span-2"
                        disabled={!canEdit}
                        onBlur={() =>
                          setEditTouched((current) => ({
                            ...current,
                            [booking._id]: {
                              ...current[booking._id],
                              description: true,
                            },
                          }))
                        }
                        onChange={(event) =>
                          handleEdit(
                            booking._id,
                            "description",
                            event.target.value,
                          )
                        }
                        value={formState?.description ?? booking.description}
                      />
                      <div>
                        <input
                          className="w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 disabled:bg-slate-100"
                          disabled={!canEdit}
                          onBlur={() =>
                            setEditTouched((current) => ({
                              ...current,
                              [booking._id]: {
                                ...current[booking._id],
                                startsAt: true,
                              },
                            }))
                          }
                          onChange={(event) =>
                            handleEdit(
                              booking._id,
                              "startsAt",
                              event.target.value,
                            )
                          }
                          type="datetime-local"
                          value={
                            formState?.startsAt ??
                            formatDateTimeInput(booking.startsAt)
                          }
                        />
                        {touched.startsAt && editErrors.startsAt ? (
                          <p className="mt-2 text-sm text-danger">
                            {editErrors.startsAt}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <input
                          className="w-full rounded-2xl border border-slate-200 transition hover:border-slate-300 px-4 py-3 disabled:bg-slate-100"
                          disabled={!canEdit}
                          onBlur={() =>
                            setEditTouched((current) => ({
                              ...current,
                              [booking._id]: {
                                ...current[booking._id],
                                endsAt: true,
                              },
                            }))
                          }
                          onChange={(event) =>
                            handleEdit(
                              booking._id,
                              "endsAt",
                              event.target.value,
                            )
                          }
                          type="datetime-local"
                          value={
                            formState?.endsAt ??
                            formatDateTimeInput(booking.endsAt)
                          }
                        />
                        {touched.endsAt && editErrors.endsAt ? (
                          <p className="mt-2 text-sm text-danger">
                            {editErrors.endsAt}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {bookingErrors[booking._id] ? (
                      <p className="mt-4 text-sm text-danger">
                        {bookingErrors[booking._id]}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className="rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-80 active:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canEdit}
                        onClick={() => void handleSave(booking._id)}
                        type="button"
                      >
                        Save
                      </button>
                      {canDeleteResources(user) ? (
                        <button
                          className="rounded-[10px] px-5 py-2.5 text-sm font-normal text-danger transition hover:bg-rose-50 active:opacity-70"
                          onClick={() => void handleDelete(booking._id)}
                          type="button"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <StatusPanel
            title="No bookings"
            message="Add the first scheduling entry for this organization."
          />
        )}
      </section>
    </div>
  );
};
